import { budgetHint, budgetStatus } from './budget.js'
import { seatFor } from './live-projection.js'

export const createRoomRefresher = ({ store, engine, emit, usage: usagePort }) => {
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

  const refresh = (entry, { force = false } = {}) => {
    const now = Date.now()
    if (!force && now - entry.refreshedAt < 1_500) return
    entry.refreshedAt = now
    return (async () => {
      const room = store.readRoom(entry.roomId)
      if (room === null) return
      try {
        const bases = await engine.rooms()
        const seatBases = Object.entries(room.seatRooms ?? {})
          .map(([seat, ref]) => ({ seat, base: bases.find(item => item.id === ref.id) }))
          .filter(item => item.base !== undefined)
        const busySeats = seatBases.filter(item => item.base.working === true).map(item => item.seat)
        const chatBase = room.chatRoom === undefined ? undefined : bases.find(item => item.id === room.chatRoom.id)
        const usageBases = [
          ...seatBases.map(item => item.base),
          ...(chatBase === undefined ? [] : [chatBase]),
        ]
        entry.baseRoom = chatBase ?? entry.baseRoom
        const nextUsage = usageBases.reduce((total, base) => {
          total.turns += base.usage.turns ?? 0
          total.costMicroUsd += base.usage.costMicroUsd ?? 0
          total.tokens.input += base.usage.tokens?.input ?? 0
          total.tokens.output += base.usage.tokens?.output ?? 0
          total.tokens.cachedInput += base.usage.tokens?.cachedInput ?? 0
          return total
        }, { turns: 0, costMicroUsd: 0, tokens: { input: 0, output: 0, cachedInput: 0 } })
        const previous = room.usage
        const updated = store.updateRoom(entry.roomId, current => {
          const toSeat = ref => (typeof ref === 'string' ? seatFor(current, ref) ?? ref : ref)
          const toSeats = map => Object.fromEntries(Object.entries(map ?? {}).map(([ref, value]) => [toSeat(ref), value]))
          current.busy = busySeats.length > 0
          current.busySeat = busySeats[0] ?? ''
          current.busySeats = busySeats
          current.chatWorking = chatBase?.working === true
          current.chatBusySeat = toSeat(chatBase?.busyRef) ?? ''
          current.chatQueue = (chatBase?.queue ?? []).map(item => ({
            seat: toSeat(item.memberRef),
            state: item.state,
            position: item.position,
            of: item.of,
            waitingFor: item.waitingForRef === undefined ? null : toSeat(item.waitingForRef),
          }))
          current.chatHolds = toSeats(chatBase?.holds)
          current.chatUnread = chatBase?.unread === true
          current.usage = { ...current.usage, ...nextUsage }
          return { events: [] }
        })
        if (updated === null) return
        try {
          usagePort.record(updated, previous)
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

  return { refresh }
}
