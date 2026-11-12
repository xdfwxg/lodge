import { budgetHint, budgetStatus } from './budget.js'

export const createRoomRefresher = ({ store, engine, emit, usage }) => {
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
          usage.record(updated, previous)
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
