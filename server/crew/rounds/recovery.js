import { OPEN_ROUND_STATUSES, ROUND_STATUS } from '../../../shared/work-round.js'

// 启动时把房间和轮次的指针修回一致；不改写已终态轮次的内容。
export const reconcileRounds = ({ store, emit = () => {} }) => {
  let changed = 0
  for (const room of store.readRooms()) {
    const rounds = store.readWorkRounds(room.id)
    const open = rounds.filter(round => OPEN_ROUND_STATUSES.has(round.status))
    const active = typeof room.activeRoundId === 'string'
      ? rounds.find(round => round.id === room.activeRoundId) ?? null
      : null

    if (active !== null && !OPEN_ROUND_STATUSES.has(active.status)) {
      const updated = store.updateRoom(room.id, current => {
        current.activeRoundId = null
        current.lastRoundId = active.id
        current.state = current.archivedAt ? 'stopped' : 'idle'
        current.idle = current.state === 'idle'
        return { events: [{ type: 'round.reconciled', payload: { roundId: active.id, to: current.state } }] }
      })
      if (updated !== null) { emit('room', updated); changed += 1 }
      continue
    }

    if (active === null && open.length > 0) {
      const keep = open[0]
      if (room.archivedAt || room.state === 'stopped') {
        const finished = store.finishWorkRound({
          roomId: room.id,
          roundId: keep.id,
          status: ROUND_STATUS.stopped,
          roomPatch: { state: 'stopped', idle: false },
          eventType: 'round.stopped',
          idempotencyKey: `round-recover-stop:${keep.id}`,
        })
        if (finished !== null) {
          if (finished.round !== null) emit('round', finished.round)
          if (finished.room !== null) emit('room', finished.room)
          changed += 1
        }
        continue
      }
      const updated = store.updateRoom(room.id, current => {
        current.activeRoundId = keep.id
        current.state = 'active'
        current.idle = false
        return { events: [{ type: 'round.reconciled', payload: { roundId: keep.id, to: 'active' } }] }
      })
      if (updated !== null) { emit('room', updated); changed += 1 }
    }
  }
  return changed
}
