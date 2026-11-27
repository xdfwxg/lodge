import * as log from '../../log.js'
import { createBodySwap } from '../../kernel/live/body-swap.js'
import { createLiveApprovals } from '../../kernel/live/approvals.js'
import { createMessageProjector } from '../../kernel/live/projection.js'
import { createRoomRefresher } from '../../kernel/live/refresh.js'
import { createMemberSync } from '../../kernel/live/sync.js'
import { createRoomChat } from '../../kernel/live/bus.js'
import { memberDisplayName } from '../../member-labels.js'
import { leadMemberOf } from '../../room-members.js'
import { createSurfaces } from '../../surface-delivery.js'
import { resetWriteGuard } from '../../workspace-guard.js'
import { roomModeOfRoom } from '../kinds.js'
import { resolveRoomType } from '../kinds.js'
import { supportsRuntime } from '../../runtime-port.js'
import { createChatRuntime } from '../chat/runtime.js'
import { createStudioRuntime } from '../studio/runtime/runtime.js'
import { retireRoomResources } from './retire.js'

// 基座重启后，之前等回答的卡在基座那边已经不存在：本地标成已失效，别让它永远挂着。
// 历史重放会把旧卡重新落库，所以要在成员历史同步之后调用。
const sweepStaleCards = (store, roomId, before) => {
  const room = store.readRoom(roomId)
  const messages = store.readMessages(roomId)
  const answered = new Set([
    ...(Array.isArray(room?.cardAnswers) ? room.cardAnswers : []),
    ...messages
      .filter(message => message.kind === 'system' && message.meta?.kind === 'card-answered')
      .map(message => message.meta?.requestId),
  ])
  // 只收比 attach 更早的卡；attach 期间实时送来的问题还在等，不能当成旧卡。
  const stale = [...new Set(messages
    .filter(message => (
      message.kind === 'question' &&
      typeof message.meta?.card?.requestId === 'string' &&
      (typeof message.ts !== 'number' || message.ts < before)
    ))
    .map(message => message.meta.card.requestId))]
    .filter(requestId => !answered.has(requestId))
  for (const requestId of stale) {
    store.appendMessage(roomId, {
      kind: 'system',
      text: '房间重新连接，之前等回答的问题已失效。',
      meta: { kind: 'card-answered', requestId },
    })
  }
}

// M3 实时房间：一个房间 = 三个独立的基座线程/工作区，产品时间线仍由 Lodge 持有。
export const createLiveRooms = ({
  store,
  engine,
  emit,
  ports,
  approvalTimeoutMs,
  retryMs = 30_000,
  startAttempts = 4,
  surfaces = createSurfaces({ engine, store }),
}) => {
  const { roomFiles } = ports
  const entries = new Map()
  const pendingAttach = new Map()
  let retryScheduled = false
  // 服务层在建房时注入：规划师对齐回合结束后自动确认对齐，不再等人点一个没有界面的确认。
  let confirmStage = null
  let applyPlan = null
  let adjustModel = null
  let rewindStage = null
  let stopRound = null
  let resumeRound = null
  let promiseRunner = null
  let emailRunner = null
  const projector = createMessageProjector({ store })
  const refresher = createRoomRefresher({ store, engine, emit })
  const approvals = createLiveApprovals({
    store,
    engine,
    emit,
    approvalTimeoutMs,
    readOnlyFor: room => roomModeOfRoom(room)?.approvalReadOnly?.(room) === true,
  })
  const sync = createMemberSync({ store, engine, projector })
  const refreshRoom = refresher.refresh
  const strategies = [
    createChatRuntime({ store, engine, emit, refreshRoom }),
    createStudioRuntime({
      store,
      engine,
      emit,
      ports,
      approvals,
      refreshRoom,
      setMembers: (roomId, ids) => chat.setMembers(roomId, ids),
      confirmStage: (roomId, index, options) => confirmStage?.(roomId, index, options),
      applyPlan: (roomId, proposal) => applyPlan?.(roomId, proposal),
      adjustModel: (roomId, request) => adjustModel?.(roomId, request),
      rewindStage: (roomId, request) => rewindStage?.(roomId, request),
      stopRound: (roomId, request) => stopRound?.(roomId, request),
      resumeRound: roomId => resumeRound?.(roomId),
    }),
  ]
  const strategyFor = room => {
    const typeId = resolveRoomType(room?.roomType)?.id ?? ''
    const strategy = strategies.find(item => item.owns(typeId))
    if (strategy === undefined) throw new Error(`没有 ${room?.roomType ?? '未知'} 房型的策略`)
    return strategy
  }
  const memberHandlers = {
    answerPermission: (entry, memberId, message) => approvals.answerPermission(entry, memberId, message, refreshRoom),
    refresh: refreshRoom,
  }

  const chat = createRoomChat({
    store,
    engine,
    projector,
    refresh: refreshRoom,
    emit,
    onPermission: (entry, memberId, message, chatRoom) => entry.strategy.permissionCard(entry, memberId, message, chatRoom),
    onTurn: (entry, room, message) => entry.strategy.captureTurn?.(entry, message),
    onTool: (entry, room, message) => entry.strategy.toolGuard?.(entry, room, message),
  })

  const markDisconnected = (roomId, error) => {
    const text = `Lodge 服务连接中断：${error?.message ?? error}`
    const updated = store.updateRoom(roomId, current => {
      if (current.live !== true) return null
      if (current.connectionError === text) return null
      current.connectionError = text
      return { events: [{ type: 'room.connection', payload: { connected: false } }] }
    })
    if (updated !== null) emit('room', updated)
  }

  const markConnected = roomId => {
    const updated = store.updateRoom(roomId, current => {
      if (current.connectionError === undefined || current.connectionError === null) return null
      delete current.connectionError
      return { events: [{ type: 'room.connection', payload: { connected: true } }] }
    })
    if (updated !== null) emit('room', updated)
  }

  let retry = () => {}
  const scheduleRetry = () => {
    if (retryScheduled) return
    retryScheduled = true
    retry = () => {
      retryScheduled = false
      void start(0)
    }
    setTimeout(() => retry(), retryMs).unref()
  }

  const attachNow = async (room, { resume = true } = {}) => {
    const members = (room.members ?? []).filter(member => typeof member.body?.roomRef === 'string' && member.body.roomRef !== '')
    // Lodge 是一间只有主持人的聊天室：没有成员线程，但主持人自己就是基座房间。
    const hostRef = room.chatHost?.memberRef
    const hostOnlyChat = members.length === 0 && typeof hostRef === 'string' && hostRef !== '' &&
      roomModeOfRoom(room)?.allowsHostOnly?.(room) === true
    if (members.length === 0 && !hostOnlyChat) throw new Error('房间没有成员线程')
    const strategy = strategyFor(room)
    const entry = {
      roomId: room.id,
      members: new Map(),
      strategy,
      syncing: new Set(),
      answeredCards: new Set(),
      heldCards: new Map(),
      deciding: new Set(),
      approvalTimers: new Map(),
      refreshedAt: 0,
    }
    try {
      // 每套房型自己创建运行时：聊天室是发言调度，工作室是阶段/验收回合。
      strategy.create(entry, room)
      entries.set(room.id, entry)
      await approvals.expireApprovals(entry, room.id, '房间重新连接，上一张权限卡已不在等待')
      const attachedAt = Date.now()
      const bases = await engine.rooms()
      for (const member of members) {
        const base = bases.find(item => item.id === member.body.roomRef)
        if (base === undefined) throw new Error(`engine 里没有 ${member.id} 成员线程`)
        entry.members.set(member.id, { roomRef: base.id, sessionRef: base.sessionRef, unsubscribe: null })
        await sync.syncMember(entry, member.id)
        sync.subscribeMember(entry, member.id, memberHandlers)
      }
      // 成员历史同步会把基座重放出来的旧卡重新落库，所以扫完旧卡再进房间。
      sweepStaleCards(store, room.id, attachedAt)
      const liveRoom = await chat.ensure(room)
      chat.subscribe(entry, liveRoom)
      roomFiles.writeGoal(liveRoom)
      roomFiles.writeProgress?.(liveRoom, store.readRecentMessages(room.id))
      await refreshRoom(entry, { force: true })
      if (approvals.resumeApprovalPauseIfSettled(room.id) !== null) await refreshRoom(entry, { force: true })
      if (resume) await strategy.resume(entry)
      markConnected(room.id)
      const current = store.readRoom(room.id) ?? room
      await strategy.resumeIfRunning(entry, current)
      emit('room', current)
      log.info(`live room attached: ${current.name} ${room.id}`)
      return entry
    } catch (error) {
      // 半途失败不能留下一个“已连接”的空 entry，否则后续 attach 会直接复用它。
      try { entry.strategy?.detach?.(entry) } catch {}
      try { chat.detach(entry) } catch {}
      for (const target of entry.members.values()) {
        try { target.unsubscribe?.() } catch {}
      }
      entries.delete(room.id)
      throw error
    }
  }

  const attach = async (room, options) => {
    const existing = entries.get(room.id)
    if (existing !== undefined) return existing
    const pending = pendingAttach.get(room.id)
    if (pending !== undefined) return pending
    const task = attachNow(room, options)
    pendingAttach.set(room.id, task)
    try {
      return await task
    } finally {
      pendingAttach.delete(room.id)
    }
  }

  const attachMember = async (roomId, memberId) => {
    const entry = entries.get(roomId)
    if (entry === undefined) return false
    if (entry.members.has(memberId)) return true
    const room = store.readRoom(roomId)
    const member = room?.members?.find(item => item.id === memberId)
    const ref = member?.body?.roomRef
    if (typeof ref !== 'string' || ref === '') throw new Error(`房间没有 ${memberId} 成员线程`)
    const bases = await engine.rooms()
    const base = bases.find(item => item.id === ref)
    if (base === undefined) throw new Error(`engine 里没有 ${memberId} 成员线程`)
    entry.members.set(memberId, { roomRef: base.id, sessionRef: base.sessionRef, unsubscribe: null })
    await sync.syncMember(entry, memberId)
    sync.subscribeMember(entry, memberId, memberHandlers)
    return true
  }

  const detachMember = (roomId, memberId) => {
    const entry = entries.get(roomId)
    const target = entry?.members.get(memberId)
    if (target === undefined) return false
    target.unsubscribe?.()
    entry.members.delete(memberId)
    return true
  }

  const bodySwap = createBodySwap({ store, engine, emit, attachMember, detachMember })

  // 删房时把成员身体、隐藏 Bot 和房间聊天群一起退役；工作区与用户文件不在这层处理。
  const retireRoomBots = async room => retireRoomResources({ engine, room })

  const detach = roomId => {
    const entry = entries.get(roomId)
    if (entry === undefined) return
    entry.strategy?.detach(entry)
    void approvals.expireApprovals(entry, roomId, '房间绑定已断开，上一张权限卡已不在等待')
    chat.detach(entry)
    for (const target of entry.members.values()) target.unsubscribe?.()
    entries.delete(roomId)
    resetWriteGuard(roomId)
  }

  const start = async (attempt = 0) => {
    let failed = false
    try {
      await engine.rooms()
      for (const room of store.readRooms()) {
        if (room.live !== true) continue
        try {
          await attach(room)
          markConnected(room.id)
        } catch (error) {
          failed = true
          // attach 可能是半途失败：已经建好的订阅要先拆掉，否则每次重试都多留一条连接。
          detach(room.id)
          markDisconnected(room.id, error)
          log.warn(`live room not attached: ${room.id} ${error?.message ?? error}`)
        }
      }
    } catch (error) {
      if (attempt < startAttempts) {
        setTimeout(() => void start(attempt + 1), retryMs).unref()
        return
      }
      for (const room of store.readRooms()) {
        if (room.live === true) markDisconnected(room.id, error)
      }
      log.warn(`live rooms not started: ${error?.message ?? error}`)
      scheduleRetry()
      return
    }
    if (failed) scheduleRetry()
  }

  const sendToMember = async (roomId, memberId, text, options = {}) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('房间还没有连上')
    const room = store.readRoom(roomId)
    // 工作室的派发和复核都走群聊 @；聊天室没有成员线程派发。
    return entry.strategy.sendToMember(entry, room, memberId, text, options)
  }

  const send = async (roomId, text, { mentions = [], meta = {} } = {}) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('房间还没有连上')
    if (entry.strategy.busyReview(entry)) throw new Error('验收员还在看，等结论出来再继续')
    const room = store.readRoom(roomId)
    if (room === null) throw new Error('没有这个房间')
    // 成员默认休眠，只有被 @ 才唤醒；人直接说话时默认唤醒主成员，避免“发了没人回”。
    const addressed = mentions.some(id => room.members?.some(member => member.id === id))
    const lead = !addressed && !/@[^\s，,。]+/.test(text)
      ? memberDisplayName(room, leadMemberOf(room)?.id ?? '')
      : ''
    // 自动唤醒的 @ 只发给基座，不写进房间记录；人看到的仍是自己说的话。
    return chat.send(room, lead === '' ? text : `@${lead} ${text}`, { displayText: text, mentions, meta })
  }

  const requestReview = async (roomId, stage) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('房间还没有连上')
    return entry.strategy.requestReview(entry, stage)
  }

  const startStage = async (room, index) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    return entry.strategy.startStage(entry, room, index)
  }

  const startChat = async (room, options = {}) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    return entry.strategy.start(entry, room, options)
  }

  const continueChat = async (room, note = '', options = {}) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    return entry.strategy.continue(entry, store.readRoom(room.id) ?? room, note, options)
  }

  const reviewChatConclusion = async (room, options = {}) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    if (typeof entry.strategy.reviewConclusion !== 'function') throw new Error('这个房间不支持结论复核')
    return entry.strategy.reviewConclusion(entry, store.readRoom(room.id) ?? room, options)
  }

  const hostIntent = async (room, text) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    if (typeof entry.strategy.hostIntent !== 'function') throw new Error('这个房型没有聊天主持')
    return entry.strategy.hostIntent(entry, store.readRoom(room.id) ?? room, text)
  }

  const reworkStage = async (room, index, note) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    return entry.strategy.startStage(entry, room, index, { note, rework: true })
  }

  // 并行阶段只重开一个分支，其他成员的工作和证据不动。
  const retryMember = async (room, index, memberId, note) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('房间还没有连上')
    return entry.strategy.startStage(entry, room, index, { note, rework: true, only: [memberId] })
  }

  const decideApproval = async (roomId, approvalId, decision) => approvals.decideApproval({
    entry: entries.get(roomId),
    roomId,
    approvalId,
    decision,
    refresh: refreshRoom,
  })

  const expireApprovals = async (roomId, reason, options = {}) => {
    const expired = await approvals.expireApprovals(entries.get(roomId), roomId, reason, options)
    approvals.resumeApprovalPauseIfSettled(roomId)
    return expired
  }

  const answerCard = (roomId, memberId, requestId, message) => approvals.answerCard({
    entry: entries.get(roomId),
    roomId,
    memberId,
    requestId,
    message,
    refresh: refreshRoom,
  })

  // 叫停/继续归基座的 room holds；Lodge 只把成员映射成身体引用。
  const cancelQueued = async (roomId, queueId) => {
    const room = store.readRoom(roomId)
    const chatId = room?.chatRoom?.id
    if (typeof chatId !== 'string' || chatId === '') throw new Error('聊天室还没准备好')
    const result = await surfaces.of(room, leadMemberOf(room)?.id ?? '').cancel({ room, queueId })
    if (result.cancelled === true) {
      const echo = store.readMessages(roomId).find(message => message.meta?.queueId === queueId)
      if (echo !== undefined) {
        store.upsertMessage({
          ...echo,
          meta: { ...echo.meta, queueId: undefined, cancelled: true },
        })
      }
      const entry = entries.get(roomId)
      if (entry !== undefined) await refreshRoom(entry, { force: true })
      emit('room', store.readRoom(roomId) ?? room)
    }
    return result
  }

  const steerQueued = async (roomId, queueId) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('房间还没有连上')
    const room = store.readRoom(roomId)
    const chatId = room?.chatRoom?.id
    if (typeof chatId !== 'string' || chatId === '') throw new Error('聊天室还没准备好')
    const result = await engine.steerRoomQueue(chatId, queueId)
    if (result.outcome === 'steered') await refreshRoom(entry, { force: true })
    return result
  }

  const holdMember = async (roomId, memberId, held) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('房间还没有连上')
    const room = store.readRoom(roomId)
    if (room === null) throw new Error('房间不存在')
    // 聊天室的“先别说”只改这一轮的发言名单，不动基座群成员。
    if (typeof entry.strategy.muteMember === 'function') {
      return entry.strategy.muteMember(entry, room, memberId, held)
    }
    if (!supportsRuntime(engine, 'holds')) throw new Error('当前版本还不支持叫停成员')
    const member = room.members?.find(item => item.id === memberId)
    const memberRef = member?.body?.ref
    const chatId = room.chatRoom?.id
    if (typeof memberRef !== 'string' || memberRef === '' || typeof chatId !== 'string' || chatId === '') {
      throw new Error('这个成员还没有连上 Lodge 服务')
    }
    await surfaces.of(room, memberId).hold({ room, memberId, held })
    await refreshRoom(entry, { force: true })
    return store.readRoom(roomId) ?? room
  }

  // 持久队列到期后按 kind 交给房型；调度器不认识房型，也不认识新的活。
  const handleWork = async event => {
    if (event.kind === 'promise.tick') {
      if (typeof promiseRunner !== 'function') return false
      return await promiseRunner(event)
    }
    if (event.kind === 'email.send') {
      if (typeof emailRunner !== 'function') return false
      return await emailRunner(event)
    }
    if (event.kind === 'approval') {
      await expireApprovals(event.roomId, '确认超时', { approvalId: event.payload?.approvalId ?? null })
      return true
    }
    if (event.kind === 'stage.deadline') {
      const entry = entries.get(event.roomId)
      if (entry === undefined) return true
      const room = store.readRoom(event.roomId)
      if (room === null) return true
      if (event.roundId !== null && room.workRound?.id !== event.roundId) return true
      entry.strategy.expireStage?.(entry, event.payload?.stage)
      return true
    }
    const entry = entries.get(event.roomId)
    // 房间还没连上时，租约和聊天轮次都不算失败；attach 会接着续跑。
    if (entry === undefined) return event.kind === 'assignment.lease' || event.kind === 'chat.round'
    const handled = await entry.strategy?.handleWork?.(entry, event)
    return handled === true
  }

  const cancel = async ({ roomId }) => {
    if (!supportsRuntime(engine, 'cancel')) return { cancelled: false, reason: '当前版本还不支持取消回合' }
    const entry = entries.get(roomId)
    if (entry === undefined) return { cancelled: false, reason: '房间还没有连上' }
    const room = store.readRoom(roomId)
    if (room === null) return { cancelled: false, reason: '房间不存在' }
    entry.strategy.cancel(entry)
    try {
      const bases = await engine.rooms()
      const busy = bases.filter(base => (
        base.working === true &&
        ((room.members ?? []).some(member => member.body?.roomRef === base.id) ||
          (room.chatRoom !== undefined && room.chatRoom.id === base.id))
      ))
      if (busy.length === 0) return { cancelled: false, reason: '当前没有正在跑的回合' }
      const results = []
      for (const base of busy) results.push(await engine.cancelTurn({ roomId: base.id }))
      const cancelled = results.filter(result => result.cancelled === true).length
      return cancelled > 0
        ? { cancelled: true, members: busy.length, cancelledMembers: cancelled }
        : { cancelled: false, reason: results.find(result => result.reason)?.reason ?? '现在没有可以取消的回合' }
    } catch (error) {
      return { cancelled: false, reason: String(error?.message ?? error) }
    }
  }

  return {
    start,
    attach,
    attachMember,
    detachMember,
    swapBody: (room, body) => bodySwap.swap(room, body),
    detach,
    retireRoomBots,
    send,
    sendToMember,
    requestReview,
    resolveMerged: (roomId, stageIndex) => {
      const entry = entries.get(roomId)
      return entry === undefined ? null : entry.strategy.resolveMerged?.(entry, stageIndex)
    },
    setConfirmStage: handler => { confirmStage = handler },
    setApplyPlan: handler => { applyPlan = handler },
    setAdjustModel: handler => { adjustModel = handler },
    setRewindStage: handler => { rewindStage = handler },
    setStopRound: handler => { stopRound = handler },
    setResumeRound: handler => { resumeRound = handler },
    setPromiseRunner: handler => { promiseRunner = handler },
    setEmailRunner: handler => { emailRunner = handler },
    handleWork,
    decideApproval,
    expireApprovals,
    answerCard,
    holdMember,
    setMembers: (roomId, ids) => chat.setMembers(roomId, ids),
    cancelQueued,
    steerQueued,
    busyReview: roomId => {
      const entry = entries.get(roomId)
      return entry === undefined ? false : entry.strategy.busyReview(entry)
    },
    isAttached: roomId => entries.has(roomId),
    startStage,
    reworkStage,
    retryMember,
    startChat,
    continueChat,
    reviewChatConclusion,
    hostIntent,
    chatRunning: roomId => entries.get(roomId)?.strategy.isRunning?.(entries.get(roomId)) ?? false,
    syncChatMembers: room => chat.syncMembers(room),
    markChatRead: room => chat.markRead(room),
    resume: async (roomId, options) => {
      const entry = entries.get(roomId)
      if (entry === undefined) return
      await entry.strategy.resume(entry, options)
    },
    cancel,
    sync: async roomId => {
      const entry = entries.get(roomId)
      if (entry === undefined) return
      for (const memberId of entry.members.keys()) await sync.syncMember(entry, memberId)
    },
    
  }
}
