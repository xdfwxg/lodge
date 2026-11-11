import { budgetHint, budgetStatus } from './budget.js'
import { createLiveTurns } from './live-turns.js'
import { decidePermission } from './permission.js'
import { writeBrief, writeGoal } from './room-repo.js'
import { recordUsage } from './usage-history.js'

const seatFor = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const [seat, memberRef] of Object.entries(room?.seatBots ?? {})) {
    if (memberRef === ref) return seat
  }
  return null
}

// M3 实时房间：一个房间 = 三个独立的基座线程/工作区，产品时间线仍由 Lodge 持有。
export const createLiveRooms = ({ store, engine, emit, dispatchPayload }) => {
  const entries = new Map()

  const toStored = (roomId, message) => {
    const room = store.readRoom(roomId)
    if (room?.hiddenBaseMessages?.includes(message.id) === true) return null
    const seat = seatFor(room, message.authorRef)
    const common = { id: message.id, roomId, ts: message.at }
    if (message.role === 'user') return { ...common, kind: 'chat', authorId: 'you', text: message.text }
    if (message.kind === 'activity') {
      return { ...common, kind: 'activity', authorId: seat ?? 'executor', text: message.text, meta: { ok: message.ok } }
    }
    if (message.kind === 'question') return { ...common, kind: 'system', text: `房间在等你处理：${message.text}` }
    return { ...common, kind: 'chat', authorId: seat ?? 'executor', text: message.text }
  }

  const syncSeat = async (entry, seat) => {
    if (entry.syncing.has(seat)) return
    const target = entry.seats.get(seat)
    if (target === undefined) return
    entry.syncing.add(seat)
    try {
      const { messages } = await engine.history(target.sessionRef)
      for (const message of messages) {
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
        } else {
          const stored = toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
        }
      }
    } finally {
      entry.syncing.delete(seat)
    }
  }

  // 到预算线只暂停新任务，不取消正在跑的回合；同一暂停只写一条系统消息。
  const pauseForBudget = (room, status) => {
    const paused = store.updateRoom(room.id, current => {
      if (current.state !== 'active') return null
      current.state = 'paused'
      current.pauseReason = 'budget'
      current.budgetBlocked = true
      current.idle = false
      return { events: [{ type: 'room.budget_pause', payload: { reason: status.roomBlocked ? 'room' : 'global' } }] }
    })
    if (paused === null) return null
    store.appendMessage(room.id, {
      kind: 'system',
      text: `预算已用尽：${status.message}；新任务已暂停，${budgetHint(status)}。`,
    })
    emit('room', paused)
    return paused
  }

  const refreshRoom = (entry, { force = false } = {}) => {
    const now = Date.now()
    if (!force && now - entry.refreshedAt < 1_500) return
    entry.refreshedAt = now
    void (async () => {
      const room = store.readRoom(entry.roomId)
      if (room === null) return
      try {
        const bases = await engine.rooms()
        const seatBases = Object.entries(room.seatRooms ?? {})
          .map(([seat, ref]) => ({ seat, base: bases.find(item => item.id === ref.id) }))
          .filter(item => item.base !== undefined)
        const busySeats = seatBases.filter(item => item.base.working === true).map(item => item.seat)
        const usage = seatBases.reduce((total, item) => {
          total.turns += item.base.usage.turns ?? 0
          total.costMicroUsd += item.base.usage.costMicroUsd ?? 0
          total.tokens.input += item.base.usage.tokens?.input ?? 0
          total.tokens.output += item.base.usage.tokens?.output ?? 0
          total.tokens.cachedInput += item.base.usage.tokens?.cachedInput ?? 0
          return total
        }, { turns: 0, costMicroUsd: 0, tokens: { input: 0, output: 0, cachedInput: 0 } })
        const previous = room.usage
        const updated = store.updateRoom(entry.roomId, current => {
          current.busy = busySeats.length > 0
          current.busySeat = busySeats[0] ?? ''
          current.busySeats = busySeats
          current.usage = { ...current.usage, ...usage }
          return { events: [] }
        })
        if (updated === null) return
        try {
          recordUsage(updated, previous)
        } catch (error) {
          console.warn(`usage history failed: ${updated.id} ${error?.message ?? error}`)
        }
        emit('room', updated)
        if (updated.state === 'active') {
          const status = budgetStatus(updated, store.readRooms())
          if (!status.ok) pauseForBudget(updated, status)
        }
      } catch {
        return
      }
    })()
  }

  const answerPermission = async (entry, seat, message) => {
    const card = message?.card
    if (card?.requestType !== 'permission' || typeof card.requestId !== 'string') return
    if (entry.answeredCards.has(card.requestId)) return
    entry.answeredCards.add(card.requestId)
    const spec = store.readRoom(entry.roomId)?.seatSpecs?.find(item => item.id === seat)
    const allowed = decidePermission(spec, card.action)
    try {
      const result = await engine.answerCard({
        sessionRef: entry.seats.get(seat)?.sessionRef,
        requestId: card.requestId,
        behavior: allowed ? 'allow' : 'deny',
      })
      if (result?.ok === false) throw new Error(result.error ?? '基座拒绝了权限卡答案')
      if (!allowed) {
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: `权限拒绝：${spec?.name ?? seat} 不能使用 ${card.tool ?? card.action ?? '该工具'}。`,
        })
      }
      refreshRoom(entry, { force: true })
    } catch (error) {
      entry.answeredCards.delete(card.requestId)
      store.appendMessage(entry.roomId, { kind: 'system', text: `权限卡处理失败：${error?.message ?? error}` })
    }
  }

  const subscribeSeat = (entry, seat) => {
    const target = entry.seats.get(seat)
    if (target === undefined) return
    target.unsubscribe = engine.subscribe({
      roomId: target.roomRef,
      sessionRef: target.sessionRef,
      onState: state => {
        if (state.connected) void syncSeat(entry, seat)
      },
      onEvent: event => {
        if (event.type === 'room') {
          refreshRoom(entry, { force: true })
          return
        }
        const message = event.message
        if (message?.card?.requestType === 'permission') {
          void answerPermission(entry, seat, message)
          return
        }
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
          refreshRoom(entry, { force: true })
        } else {
          const stored = toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
          refreshRoom(entry)
        }
      },
    })
  }

  const attach = async room => {
    if (entries.has(room.id)) return entries.get(room.id)
    const seatRefs = room.seatRooms ?? {}
    const seatKeys = Object.keys(seatRefs)
    if (seatKeys.length === 0) throw new Error('房间没有席位线程')
    const turns = createLiveTurns({
      store,
      engine,
      roomId: room.id,
      emit,
      sendToSeat: (seat, text) => sendToSeat(room.id, seat, text),
    })
    const entry = { roomId: room.id, seats: new Map(), turns, syncing: new Set(), answeredCards: new Set(), refreshedAt: 0 }
    entries.set(room.id, entry)
    const bases = await engine.rooms()
    for (const seat of seatKeys) {
      const ref = seatRefs[seat]
      const base = bases.find(item => item.id === ref.id)
      if (base === undefined) throw new Error(`engine 里没有 ${seat} 席位线程`)
      entry.seats.set(seat, { roomRef: base.id, sessionRef: base.sessionRef, unsubscribe: null })
      await syncSeat(entry, seat)
      subscribeSeat(entry, seat)
    }
    writeBrief(room)
    writeGoal(room)
    await refreshRoom(entry, { force: true })
    const current = store.readRoom(room.id) ?? room
    emit('room', current)
    console.log(`live room attached: ${current.name} ${room.id}`)
    return entry
  }

  const detach = roomId => {
    const entry = entries.get(roomId)
    if (entry === undefined) return
    for (const target of entry.seats.values()) target.unsubscribe?.()
    entries.delete(roomId)
  }

  const start = async (attempt = 0) => {
    try {
      await engine.rooms()
      for (const room of store.readRooms()) {
        if (room.live !== true) continue
        if (room.seatRooms === undefined) {
          const migrated = store.updateRoom(room.id, current => {
            current.live = false
            current.state = 'stopped'
            return { events: [{ type: 'room.migrated', payload: { reason: 'legacy single-room live room' } }] }
          })
          if (migrated !== null) {
            store.appendMessage(room.id, { kind: 'system', text: '旧版单线程实时房间已停止；请新建一个隔离房间。' })
            emit('room', migrated)
          }
          continue
        }
        try {
          await attach(room)
        } catch (error) {
          console.warn(`live room not attached: ${room.id} ${error?.message ?? error}`)
        }
      }
    } catch (error) {
      if (attempt < 4) {
        setTimeout(() => void start(attempt + 1), 3_000).unref()
        return
      }
      console.warn(`live rooms not started: ${error?.message ?? error}`)
    }
  }

  const sendToSeat = async (roomId, seat, text) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('实时房间未绑定')
    const target = entry.seats.get(seat)
    if (target === undefined) throw new Error(`房间没有 ${seat} 席位`)
    return engine.sendTurn({ roomId: target.roomRef, text })
  }

  const send = async (roomId, text) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('实时房间未绑定')
    if (entry.turns.busyReview()) throw new Error('复核进行中，先等验收结论')
    const room = store.readRoom(roomId)
    const seat = room?.leadSeat ?? room?.members?.[0]
    if (typeof seat !== 'string') throw new Error('房间没有可对话的席位')
    return sendToSeat(roomId, seat, text)
  }

  const requestReview = async (roomId, stage) => {
    const entry = entries.get(roomId)
    if (entry === undefined) throw new Error('实时房间未绑定')
    return entry.turns.requestReview(stage)
  }

  const startStage = async (room, index) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('实时房间未绑定')
    return entry.turns.startStage(room, index)
  }

  const cancel = async ({ roomId }) => {
    const entry = entries.get(roomId)
    if (entry === undefined) return { cancelled: false, reason: '实时房间未绑定' }
    const room = store.readRoom(roomId)
    if (room === null) return { cancelled: false, reason: '房间不存在' }
    try {
      const bases = await engine.rooms()
      const busy = bases.filter(base => (
        base.working === true &&
        Object.values(room.seatRooms ?? {}).some(ref => ref.id === base.id)
      ))
      if (busy.length === 0) return { cancelled: false, reason: '当前没有正在跑的回合' }
      const results = []
      for (const base of busy) results.push(await engine.cancelTurn({ roomId: base.id }))
      const cancelled = results.filter(result => result.cancelled === true).length
      return cancelled > 0
        ? { cancelled: true, seats: busy.length, cancelledSeats: cancelled }
        : { cancelled: false, reason: results.find(result => result.reason)?.reason ?? '基座没有取消任何回合' }
    } catch (error) {
      return { cancelled: false, reason: String(error?.message ?? error) }
    }
  }

  return {
    start,
    attach,
    detach,
    send,
    sendToSeat,
    requestReview,
    busyReview: roomId => entries.get(roomId)?.turns.busyReview() ?? false,
    isAttached: roomId => entries.has(roomId),
    startStage,
    cancel,
    sync: async roomId => {
      const entry = entries.get(roomId)
      if (entry === undefined) return
      for (const seat of entry.seats.keys()) await syncSeat(entry, seat)
    },
    dispatchPayload,
  }
}
