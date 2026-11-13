import { createLiveApprovals } from './live-approvals.js'
import { createMessageProjector } from './live-projection.js'
import { createRoomRefresher } from './live-refresh.js'
import { createSeatSync } from './live-sync.js'
import { createLiveTurns } from './live-turns.js'
import { createRoomChat } from './live-chat.js'

// M3 实时房间：一个房间 = 三个独立的基座线程/工作区，产品时间线仍由 Lodge 持有。
export const createLiveRooms = ({ store, engine, emit, dispatchPayload, gateAgent = null, ports, approvalTimeoutMs }) => {
  const { roomFiles, usage, commands, files, skills } = ports
  const entries = new Map()
  const projector = createMessageProjector({ store })
  const refresher = createRoomRefresher({ store, engine, emit, usage })
  const approvals = createLiveApprovals({ store, engine, emit, gateAgent, approvalTimeoutMs })
  const sync = createSeatSync({ store, engine, projector })
  const refreshRoom = refresher.refresh
  const seatHandlers = {
    answerPermission: (entry, seat, message) => approvals.answerPermission(entry, seat, message, refreshRoom),
    refresh: refreshRoom,
  }

  const chat = createRoomChat({ store, engine, projector, refresh: refreshRoom, emit })

  const attach = async (room, { resume = true } = {}) => {
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
      commands,
      files,
      skills,
    })
    // 已落证据的回合在重启后会被基座历史重放；先标记，避免重复采集。
    turns.seed(store.readMessages(room.id))
    const entry = {
      roomId: room.id,
      seats: new Map(),
      turns,
      syncing: new Set(),
      answeredCards: new Set(),
      heldCards: new Map(),
      approvalTimers: new Map(),
      refreshedAt: 0,
    }
    entries.set(room.id, entry)
    approvals.expireApprovals(entry, room.id, '房间重新连接，上一张权限卡已不在等待')
    const bases = await engine.rooms()
    for (const seat of seatKeys) {
      const ref = seatRefs[seat]
      const base = bases.find(item => item.id === ref.id)
      if (base === undefined) throw new Error(`engine 里没有 ${seat} 席位线程`)
      entry.seats.set(seat, { roomRef: base.id, sessionRef: base.sessionRef, unsubscribe: null })
      await sync.syncSeat(entry, seat)
      sync.subscribeSeat(entry, seat, seatHandlers)
    }
    const liveRoom = await chat.ensure(room)
    chat.subscribe(entry, liveRoom)
    roomFiles.writeBrief(liveRoom)
    roomFiles.writeGoal(liveRoom)
    await refreshRoom(entry, { force: true })
    if (approvals.resumeApprovalPauseIfSettled(room.id) !== null) await refreshRoom(entry, { force: true })
    if (resume) await entry.turns.resume()
    const current = store.readRoom(room.id) ?? room
    emit('room', current)
    console.log(`live room attached: ${current.name} ${room.id}`)
    return entry
  }

  const attachSeat = async (roomId, seat) => {
    const entry = entries.get(roomId)
    if (entry === undefined) return false
    if (entry.seats.has(seat)) return true
    const room = store.readRoom(roomId)
    const ref = room?.seatRooms?.[seat]
    if (ref === undefined) throw new Error(`房间没有 ${seat} 席位线程`)
    const bases = await engine.rooms()
    const base = bases.find(item => item.id === ref.id)
    if (base === undefined) throw new Error(`engine 里没有 ${seat} 席位线程`)
    entry.seats.set(seat, { roomRef: base.id, sessionRef: base.sessionRef, unsubscribe: null })
    await sync.syncSeat(entry, seat)
    sync.subscribeSeat(entry, seat, seatHandlers)
    return true
  }

  const detachSeat = (roomId, seat) => {
    const entry = entries.get(roomId)
    const target = entry?.seats.get(seat)
    if (target === undefined) return false
    target.unsubscribe?.()
    entry.seats.delete(seat)
    return true
  }

  const detach = roomId => {
    const entry = entries.get(roomId)
    if (entry === undefined) return
    approvals.expireApprovals(entry, roomId, '房间绑定已断开，上一张权限卡已不在等待')
    chat.detach(entry)
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
    if (room === null) throw new Error('没有这个房间')
    return chat.send(room, text)
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

  const reworkStage = async (room, index, note) => {
    const entry = entries.get(room.id)
    if (entry === undefined) throw new Error('实时房间未绑定')
    return entry.turns.startStage(room, index, { note, rework: true })
  }

  const decideApproval = async (roomId, approvalId, decision) => approvals.decideApproval({
    entry: entries.get(roomId),
    roomId,
    approvalId,
    decision,
    refresh: refreshRoom,
  })

  const expireApprovals = (roomId, reason) => approvals.expireApprovals(entries.get(roomId), roomId, reason)

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
    attachSeat,
    detachSeat,
    detach,
    send,
    sendToSeat,
    requestReview,
    decideApproval,
    expireApprovals,
    busyReview: roomId => entries.get(roomId)?.turns.busyReview() ?? false,
    isAttached: roomId => entries.has(roomId),
    startStage,
    reworkStage,
    syncChatMembers: room => chat.syncMembers(room),
    markChatRead: room => chat.markRead(room),
    resume: async (roomId, options) => {
      const entry = entries.get(roomId)
      if (entry === undefined) return
      await entry.turns.resume(options)
    },
    cancel,
    sync: async roomId => {
      const entry = entries.get(roomId)
      if (entry === undefined) return
      for (const seat of entry.seats.keys()) await sync.syncSeat(entry, seat)
    },
    dispatchPayload,
  }
}
