import { seatFor, seatNameOf } from './live-projection.js'

const seatFailureOf = message => {
  if (message?.kind !== 'activity' || message.ok !== false) return null
  const text = String(message.text ?? '')
  return /^error:\s/i.test(text) ? text : null
}

const seatFailureKind = text => {
  const lower = text.toLowerCase()
  if (lower.includes('余额') || lower.includes('insufficient') || lower.includes('quota') || lower.includes('credit')) return 'quota'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key')) return 'auth'
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) return 'rate_limit'
  return 'engine'
}

const failureCopy = (kind, name) => ({
  quota: `${name}的模型额度不足，房间已暂停。充值或给这个席位换一个模型后，点“继续”。`,
  auth: `${name}的模型登录或密钥失效，房间已暂停。重新登录或换一个引擎后，点“继续”。`,
  rate_limit: `${name}被模型服务限流，房间已暂停。稍后点“继续”，或给这个席位换一个模型。`,
  engine: `${name}调用模型失败，房间已暂停。检查引擎配置后，点“继续”。`,
}[kind])

// 引擎级错误（余额、鉴权、限流）不是普通命令失败；房间要停下来等人处理。
export const pauseForSeatFailure = (store, entry, message) => {
  const text = seatFailureOf(message)
  if (text === null) return
  const room = store.readRoom(entry.roomId)
  if (room === null) return
  const seat = seatFor(room, message.authorRef) ?? 'executor'
  const kind = seatFailureKind(text)
  const updated = store.updateRoom(entry.roomId, current => {
    if (current.state !== 'active') return null
    current.state = 'paused'
    current.pauseReason = 'seat_error'
    current.idle = false
    current.seatError = { seat, kind, at: Date.now(), detail: text.slice(0, 500) }
    const stageIndex = current.stages?.findIndex(stage => stage.state === 'active') ?? -1
    if (stageIndex >= 0 && Array.isArray(current.stages[stageIndex].tasks)) {
      current.stages[stageIndex].tasks = current.stages[stageIndex].tasks.map(task => (
        task.owner === seat ? { ...task, status: 'failed' } : task
      ))
    }
    return { events: [{ type: 'room.seat_error', payload: { seat, kind, detail: text.slice(0, 500) } }] }
  })
  if (updated !== null) {
    store.appendMessage(entry.roomId, {
      kind: 'system',
      text: failureCopy(kind, seatNameOf(room, seat)),
    })
  }
}

export const createSeatSync = ({ store, engine, projector }) => {
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
          const stored = projector.toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
          pauseForSeatFailure(store, entry, message)
        }
      }
    } finally {
      entry.syncing.delete(seat)
    }
  }

  const subscribeSeat = (entry, seat, { answerPermission, refresh }) => {
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
          refresh(entry, { force: true })
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
          refresh(entry, { force: true })
        } else {
          const stored = projector.toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
          pauseForSeatFailure(store, entry, message)
          refresh(entry)
        }
      },
    })
  }

  return { syncSeat, subscribeSeat }
}
