import { randomUUID } from 'node:crypto'
import * as log from '../../log.js'
import { matchEcho, memberForRef } from './projection.js'
import { leadMemberOf, memberOf } from '../../room-members.js'
import { pauseForMemberFailure } from './sync.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from '../../room-chat.js'
import { roomModeOfRoom, roomPresentationOfRoom } from '../../rooms/kinds.js'
import { supportsRuntime } from '../../runtime-port.js'
import { toBaseMentions, toDisplayMentions, toDisplayText, toIdMentions, unknownMentionsOf } from '../../member-labels.js'
import { systemNotice } from '../../notices.js'

// 隐藏主持与当前发言人由房型的 presentation 提供；总线不认识任何具体房型。
const FINAL_IDS_KEEP = 500

// 一条迟到消息属于哪个轮次，看它这一回合是什么时候开始的，而不是什么时候到达。
export const turnStartOf = message => {
  // 基座在 from.since 上记了这段回合开始的时间；它比消息到达时间更能说明属于哪一轮。
  const since = Number(message?.from?.since)
  if (Number.isFinite(since)) return since
  const at = Number.isFinite(message?.at) ? message.at : null
  const duration = Number(message?.turn?.durationMs ?? message?.durationMs)
  if (at === null) return null
  return Number.isFinite(duration) && duration >= 0 ? at - duration : at
}

export const roundAtOf = (room, at) => {
  if (!Number.isFinite(at)) return undefined
  const rounds = (Array.isArray(room?.rounds) ? room.rounds : [])
    .filter(round => Number.isFinite(round?.startedAt))
    .sort((a, b) => a.startedAt - b.startedAt)
  let chosen
  for (const round of rounds) if (at >= round.startedAt) chosen = round
  return chosen?.id
}

// 房间快照不背全部轮次；按消息时间归轮时直接从存储取，避免永远落到当前轮。
const roundIdForMessage = (store, room, message) => roundAtOf(
  { ...room, rounds: store.readWorkRounds?.(room.id) ?? room.rounds },
  turnStartOf(message),
)

const hostOf = room => roomPresentationOfRoom(room)?.hostOf?.(room) ?? null
const speakerOf = room => roomPresentationOfRoom(room)?.speakerOf?.(room) ?? ''
// 有些回答不是发言（例如聊天室的结论复核）；流式路径和最终投影走同一条房型规则。
const hiddenOf = (room, message) => roomPresentationOfRoom(room)?.hiddenMessageOf?.(room, message) === true

// 基座回合是异步的；先把人的话落到房间里，输入框才不会看起来没反应。
// sendId 是基座的幂等键：发送响应和最终落库 ID 不同也能对上同一条话。
export const echoHumanMessage = ({ store, roomId, text, messageId, sendId, queueId, meta = {} }) => {
  const echo = {
    roomId,
    ts: Date.now(),
    kind: 'chat',
    authorId: 'you',
    text,
    meta: {
      echo: true,
      ...meta,
      ...(typeof sendId === 'string' && sendId !== '' ? { sendId } : {}),
      ...(typeof queueId === 'string' && queueId !== '' ? { queueId } : {}),
    },
  }
  if (typeof sendId === 'string' && sendId !== '') {
    store.upsertMessage({ ...echo, id: `optimistic:${sendId}` })
  } else if (typeof messageId === 'string' && messageId !== '') {
    store.upsertMessage({ ...echo, id: messageId })
  } else {
    store.appendMessage(roomId, echo)
  }
}

// 房间对话走基座原生群聊：成员、@、上下文和沉默都由基座负责。
// 这里只管创建/重连/收发，不把聊天变成阶段回合。
export const createRoomChat = ({ store, engine, projector, refresh, emit = () => {}, onPermission, onTurn, onTool = null }) => {
  const streamOf = entry => {
    if (entry.chatStreams === undefined) entry.chatStreams = new Map()
    return entry.chatStreams
  }

  const finalIdsOf = entry => {
    if (entry.chatFinalIds === undefined) entry.chatFinalIds = new Set()
    return entry.chatFinalIds
  }

  const rememberFinal = (entry, id) => {
    const ids = finalIdsOf(entry)
    ids.add(id)
    while (ids.size > FINAL_IDS_KEEP) ids.delete(ids.values().next().value)
  }

  const applyDelta = (entry, room, event) => {
    // 流式是可选能力：runtime 没声明就不接增量，历史同步仍会把最终消息补进来。
    if (!supportsRuntime(engine, 'streaming')) return
    const current = store.readRoom(room.id) ?? room
    if (roomPresentationOfRoom(current)?.acceptsDelta !== true) return
    // 隐藏主持模型只负责总结，不把它的原始回复流进时间线；结论由 Lodge 写卡片。
    const host = hostOf(current)
    if (host !== null && entry.baseRoom?.busyRef === host.memberRef) return
    // 基座正在发言的人才是这一段 delta 的作者；自造的 speaker 只在拿不到基座状态时兜底。
    const memberId = (entry.baseRoom?.busyRef === undefined ? null : memberForRef(current, entry.baseRoom.busyRef))
      ?? speakerOf(current)
    if (typeof memberId !== 'string' || memberId === '') return
    const streams = streamOf(entry)
    const prior = streams.get(memberId)
    const turnId = typeof event.turnId === 'string' ? event.turnId : ''
    // 复核回复会被流式推过来；不能先在时间线里放一个占位气泡。
    if (hiddenOf(current, { authorRef: entry.baseRoom?.busyRef, turnId, memberId })) return
    // 流式消息按回合区分：同一成员在一轮里发多次言时不能覆盖上一条。
    const sameTurn = prior !== undefined && prior.turnId === turnId
    const id = sameTurn ? prior.id : `stream:${room.id}:${memberId}:${turnId}`
    const existing = store.readMessage(room.id, id)
    const raw = sameTurn && typeof existing?.text === 'string'
      ? existing.text + event.delta
      : event.delta
    // 流式阶段也映射基座成员名；否则用户先看到内部名，回合结束才变角色名。
    const text = toDisplayText(current, raw)
    store.upsertMessage({
      id,
      roomId: room.id,
      ts: Date.now(),
      kind: 'chat',
      authorId: memberId,
      text,
      meta: { streaming: true, turnId },
    })
    streams.set(memberId, { id, turnId })
  }

  const finishStream = (entry, room, message) => {
    // 用户/系统发进来的话不是成员的发言，不能拿来收口成员的流。
    if (message.role === 'user') return false
    if (message.kind !== 'text' && message.kind !== 'turn') return false
    // 一次回答的过场不结算：等正文到齐再收口，否则过场会顶掉正在流的正文。
    if (message.kind === 'text' && message.turnFinal === false) return false
    const finalIds = finalIdsOf(entry)
    if (finalIds.has(message.id)) return true
    const current = store.readRoom(room.id) ?? room
    if (roomPresentationOfRoom(current)?.acceptsDelta !== true) return false
    const memberId = memberForRef(current, message.authorRef) ?? speakerOf(current)
    if (typeof memberId !== 'string' || memberId === '') return false
    // 已经被窗口挡掉的流式占位要收掉，不能让它在最后一段正文到达时重新出现。
    if (hiddenOf(current, { ...message, memberId })) {
      const hiddenStream = streamOf(entry).get(memberId)
      const hiddenExisting = hiddenStream === undefined ? null : store.readMessage(room.id, hiddenStream.id)
      if (hiddenExisting !== null) {
        store.upsertMessage({ ...hiddenExisting, meta: { ...(hiddenExisting.meta ?? {}), stale: true } })
      }
      streamOf(entry).delete(memberId)
      rememberFinal(entry, message.id)
      return true
    }
    const streams = streamOf(entry)
    const state = streams.get(memberId)
    const raw = message.kind === 'turn' ? message.turn?.reply : message.text
    if (typeof raw !== 'string' || raw.trim() === '') {
      streams.delete(memberId)
      return false
    }
    // 流式回合的最终文本也要过一遍显示名映射，否则基座成员名会留在气泡里。
    const text = toDisplayText(current, raw)
    // 基座在 text 之后还会补一条同内容的 digest/turn；同一成员同一句只留一条。
    const plain = value => String(value ?? '').replace(/\s+/g, ' ').trim()
    const at = message.at ?? Date.now()
    // 去重只看最近一小段：同一条 digest 总在几秒内到达，不需要把整段历史读进内存。
    const duplicate = message.kind === 'turn'
      ? store.readRecentMessages(room.id, 200).find(item => (
        item.kind === 'chat' &&
        item.authorId === memberId &&
        item.meta?.final === true &&
        item.id !== state?.id &&
        Math.abs((item.ts ?? 0) - at) <= 5_000 &&
        (plain(item.text) === plain(text) ||
          // 只把“更短的 digest”当成同一句；更长的后续是真消息，不能吞。
          plain(item.text).startsWith(plain(text)))
      ))
      : undefined
    if (duplicate !== undefined) {
      const existing = state === undefined ? null : store.readMessage(room.id, state.id)
      if (existing !== null) {
        store.upsertMessage({
          ...existing,
          meta: { ...(existing.meta ?? {}), stale: true, final: true, baseId: message.id },
        })
      }
      streams.delete(memberId)
      rememberFinal(entry, message.id)
      return true
    }
    if (state === undefined) return false
    const existing = store.readMessage(room.id, state.id)
    const workRoundId = roundIdForMessage(store, current, message)
    store.upsertMessage({
      ...(existing ?? { id: state.id, roomId: room.id, kind: 'chat', authorId: memberId }),
      text,
      ts: message.at ?? Date.now(),
      meta: { ...(existing?.meta ?? {}), streaming: false, final: true, baseId: message.id },
      ...(workRoundId === undefined ? {} : { workRoundId }),
    })
    streams.delete(memberId)
    rememberFinal(entry, message.id)
    return true
  }

  // 基座忙碌时消息会排队，发送响应 id 和最终落库 id 不同；回显先占位，落库后只补 baseId，不再重复投影。
  const projectMessage = (room, message) => {
    // 隐藏主持模型的原始回复只喂给总结卡，不进入聊天时间线。
    const host = hostOf(room)
    if (host !== null && message.authorRef === host.memberRef) return null
    // 流式消息已经落库的，同步历史时不再补一条同内容的消息；查索引，不扫全房。
    if (store.findMessageByBaseId(room.id, message.id) !== null) return null
    if (message.role === 'user') {
      // 回显只可能出现在最近这段历史里；按 sendId 直接查，找不到再用最近的文本兜底。
      if (typeof message.sendId === 'string' && message.sendId !== '') {
        const echo = store.findMessageBySendId(room.id, message.sendId)
        if (echo !== null) {
          // 回显保留人输入的原话；基座消息里自动补的 @ 只用于唤醒，不改房间记录。
          const { queueId: _queued, ...meta } = echo.meta ?? {}
          store.upsertMessage({
            ...echo,
            ts: message.at ?? echo.ts,
            meta: { ...meta, baseId: message.id },
          })
          return null
        }
      }
      const echo = matchEcho(
        store.readRecentMessages(room.id, 100),
        toDisplayMentions(room, message.text),
        message.at,
      )
      if (echo !== undefined) {
        const { queueId: _queued, ...meta } = echo.meta ?? {}
        store.upsertMessage({ ...echo, meta: { ...meta, baseId: message.id } })
        return null
      }
    }
    const stored = projector.toStored(room.id, message)
    if (stored === null) return stored
    // 一次回答的过场不是发言：房间只留回合收尾的正文，免得同一个人连说两句。
    if (stored.kind === 'chat' && stored.meta?.turnFinal === false) return null
    if (stored.workRoundId !== undefined) return stored
    const workRoundId = roundIdForMessage(store, room, message)
    return workRoundId === undefined ? stored : { ...stored, workRoundId }
  }

  const sync = async entry => {
    const room = store.readRoom(entry.roomId)
    const chat = room?.chatRoom
    if (chat === undefined) return
    const { messages } = await engine.history(chat.sessionRef)
    for (const message of messages) {
      // 权限卡归实时订阅和审批桥；历史里的旧卡不能再落库，否则会留下一个永远等人的问题。
      if (message.card?.requestType === 'permission') continue
      // 事件可能丢；同步历史时也要把流式消息收口，否则会多出一条最终消息。
      const streamed = finishStream(entry, room, message)
      const stored = streamed ? null : projectMessage(room, message)
      if (stored !== null) store.upsertMessage(stored)
      pauseForMemberFailure(store, entry, message)
    }
  }

  const ensure = async room => {
    if (room.chatRoom !== undefined) {
      // 群聊默认休眠：只有被 @ 的成员才加载。工作室和聊天室都走同一条总线。
      if (supportsRuntime(engine, 'mentions') && typeof engine.setRoomMentions === 'function') {
        try {
          await engine.setRoomMentions(room.chatRoom.id)
        } catch (error) {
          // 基座通道正在跑回合时会拒绝改规则；规则通常已经生效，不把它当成房间错误。
          if (!/409|working or waiting/.test(String(error?.message ?? error))) {
            systemNotice({ store, roomId: room.id, text: '房间的群聊没能准备好；待处理。', error })
          }
        }
      }
      return room
    }
    if (!supportsRuntime(engine, 'provisioning') || typeof engine.createRoom !== 'function') return room
    const host = hostOf(room)
    // 房型决定开局谁在基座群聊里；工作室对齐时只留规划师，避免 @ 把还没轮到的人叫醒。
    const mode = roomModeOfRoom(room)
    const participantIds = typeof mode?.chatMembersOf === 'function'
      ? mode.chatMembersOf(room)
      : (room.members ?? []).map(member => member.id)
    const members = [
      ...participantIds.map(id => memberOf(room, id)?.body?.ref).filter(ref => typeof ref === 'string' && ref !== ''),
      ...(host === null ? [] : [host.memberRef]),
    ]
    if (members.length === 0) return room
    try {
      const chat = await engine.createRoom({
        name: roomChatName(room.name),
        goal: room.goal,
        bulletin: ROOM_CHAT_BULLETIN,
        members,
        cwd: room.repoPath,
        leadId: hostOf(room)?.memberRef ?? leadMemberOf(room)?.body?.ref ?? members[0],
        responder: { kind: 'mentions' },
        followMentions: false,
      })
      const updated = store.updateRoom(room.id, current => {
        if (current.chatRoom !== undefined) return null
        current.chatRoom = chat
        return { events: [{ type: 'room.chat', payload: { id: chat.id } }] }
      })
      return updated ?? store.readRoom(room.id) ?? room
    } catch (error) {
      // 群聊没建起来就不是已连接：让 attach 失败并由房间重试，别留下一个空 entry。
      log.warn(`room chat create failed: ${room.id} ${error?.message ?? error}`)
      throw error
    }
  }

  const subscribe = (entry, room) => {
    const chat = room.chatRoom
    if (chat === undefined) return
    entry.chat = {
      roomRef: chat.id,
      sessionRef: chat.sessionRef,
      unsubscribe: null,
      sync: () => sync(entry),
    }
    entry.chat.unsubscribe = engine.subscribe({
      roomId: chat.id,
      sessionRef: chat.sessionRef,
      onState: state => {
        if (!state.connected) return
        void sync(entry).catch(error => {
          systemNotice({ store, roomId: room.id, text: '聊天记录没能对上；待处理。', error })
        })
      },
      onEvent: event => {
        if (event.type === 'room') {
          entry.baseRoom = event.room
          void refresh(entry, { force: true })
          return
        }
        if (event.type === 'delta') {
          applyDelta(entry, room, event)
          void refresh(entry)
          return
        }
        const message = event.message
        if (message === undefined) return
        const current = store.readRoom(room.id) ?? room
        if (message.card?.requestType === 'permission') {
          // 权限卡是可选能力：runtime 不支持时不接管，也不把卡片投进时间线。
          if (!supportsRuntime(engine, 'approvals')) return
          const memberId = memberForRef(current, message.authorRef)
          // 权限策略归房型策略；总线只把卡片交给当前房间的策略。
          void onPermission(entry, memberId, message, chat)
          return
        }
        // 工具活动先过房型的守卫：读边界要在读发生时就拦，不等到回合结束。
        if (message.kind === 'activity') onTool?.(entry, current, message)
        // 复核和规划也可能在群聊里回合；工具活动必须先记进这一轮，判定工具才读得到。
        entry.turns?.trackTool?.(message)
        if (message.kind === 'turn') onTurn?.(entry, current, message)
        const streamed = finishStream(entry, current, message)
        if (!streamed) {
          const stored = projectMessage(current, message)
          if (stored !== null) store.upsertMessage(stored)
        }
        pauseForMemberFailure(store, entry, message)
        void refresh(entry)
      },
    })
  }

  const send = async (room, text, { displayText = text, mentions = [], meta = {} } = {}) => {
    const chat = room.chatRoom
    if (chat === undefined) throw new Error('房间聊天室还没准备好；重连房间后再试')
    // 基座原生支持 @everyone；产品文案 @所有人 只在这里映射，不自己展开成员。
    // 人挑中的成员先按 id 落成基座名，剩下的 @ 再按名字转换。
    const outgoing = toBaseMentions(room, toIdMentions(room, text, mentions)).split('@所有人').join('@everyone')
    const unknown = unknownMentionsOf(room, text)
    if (unknown.length > 0) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `这些 @ 没有对应成员：${unknown.map(name => `@${name}`).join('、')}；消息还是会发出，但他们收不到。`,
      })
    }
    const sendId = randomUUID()
    const sent = await engine.sendTurn({ roomId: chat.id, text: outgoing, sendId })
    echoHumanMessage({
      store,
      roomId: room.id,
      text: displayText,
      messageId: sent?.messageId,
      sendId,
      queueId: sent?.queueId,
      meta,
    })
    return sent
  }

  const syncMembers = async room => {
    const chat = room.chatRoom
    if (chat === undefined || typeof engine.updateRoomMembers !== 'function') return
    const host = hostOf(room)
    const mode = roomModeOfRoom(room)
    const ids = typeof mode?.chatMembersOf === 'function'
      ? mode.chatMembersOf(room)
      : (room.members ?? []).map(member => member.id)
    const members = [
      ...ids.map(id => memberOf(room, id)?.body?.ref).filter(ref => typeof ref === 'string' && ref !== ''),
      ...(host === null ? [] : [host.memberRef]),
    ]
    if (members.length === 0) return
    await engine.updateRoomMembers(chat.id, members)
  }

  const markRead = async room => {
    if (room.chatRoom === undefined || typeof engine.markRoomRead !== 'function') return
    await engine.markRoomRead(room.chatRoom.id)
    const updated = store.updateRoom(room.id, current => {
      if (current.chatUnread !== true) return null
      current.chatUnread = false
      return { events: [] }
    })
    if (updated !== null) emit('room', updated)
  }

  // “谁现在在基座群聊里”是系统层的在场名单：等用户拍板时只留规划师，
  // 被移出的人连 @ 都收不到；成员名单仍由房间状态维护，界面不受影响。
  const setMembersNow = async (roomId, ids) => {
    const room = store.readRoom(roomId)
    if (room === null || room.chatRoom === undefined) return []
    const refs = []
    const host = hostOf(room)
    if (typeof host?.memberRef === 'string' && host.memberRef !== '') refs.push(host.memberRef)
    for (const memberId of ids ?? []) {
      const ref = memberOf(room, memberId)?.body?.ref
      if (typeof ref === 'string' && ref !== '' && !refs.includes(ref)) refs.push(ref)
    }
    if (refs.length === 0) return []
    const wait = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.() })
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await engine.updateRoomMembers(room.chatRoom.id, refs)
        return [...(ids ?? [])]
      } catch (error) {
        const transient = /409|working|waiting|busy/i.test(String(error?.message ?? error))
        if (!transient || attempt === 7) {
          log.warn(`[lodge] 房间成员没能同步：${String(error?.message ?? error)}`)
          break
        }
        await wait(400 + attempt * 200)
      }
    }
    return []
  }
  // 同一间房的在场名单按顺序改，避免“先放回、后移出”的旧请求覆盖新状态。
  const memberQueues = new Map()
  const setMembers = (roomId, ids) => {
    const prior = memberQueues.get(roomId) ?? Promise.resolve()
    const task = prior.then(() => setMembersNow(roomId, ids))
    memberQueues.set(roomId, task.then(() => {}, () => {}))
    return task
  }

  const detach = entry => {
    entry.chat?.unsubscribe?.()
    delete entry.chat
  }

  return { ensure, subscribe, send, detach, syncMembers, markRead, setMembers }
}
