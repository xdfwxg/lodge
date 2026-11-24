import { OPEN_ROUND_STATUSES, ROOM_STATE, ROUND_STATUS } from '../../../shared/states.js'
import { stagesCompletedOf } from '../../../shared/room-status.js'

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
        current.state = current.archivedAt ? ROOM_STATE.stopped : ROOM_STATE.idle
        current.idle = current.state === ROOM_STATE.idle
        return { events: [{ type: 'round.reconciled', payload: { roundId: active.id, to: current.state } }] }
      })
      if (updated !== null) { emit('room', updated); changed += 1 }
      continue
    }

    if (active === null && open.length > 0) {
      const keep = open[0]
      if (room.archivedAt || room.state === ROOM_STATE.stopped) {
        const finished = store.finishWorkRound({
          roomId: room.id,
          roundId: keep.id,
          status: ROUND_STATUS.stopped,
          roomPatch: { state: ROOM_STATE.stopped, idle: false },
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
        current.state = ROOM_STATE.active
        current.idle = false
        return { events: [{ type: 'round.reconciled', payload: { roundId: keep.id, to: ROOM_STATE.active } }] }
      })
      if (updated !== null) { emit('room', updated); changed += 1 }
    }
  }
  return changed
}

// 已经走完所有阶段、只剩收尾交接的轮次，在启动时补一次交付；
// 崩溃或收尾失败留下的房间也靠这里回到终态。
export const reconcileCompletions = ({ store, completeRoom }) => {
  let completed = 0
  for (const room of store.readRooms()) {
    if (room.state !== ROOM_STATE.active) continue
    if (room.workRound?.status !== ROUND_STATUS.active) continue
    if (!stagesCompletedOf(room)) continue
    const done = completeRoom(room)
    if (done?.workRound?.status === ROUND_STATUS.completed) completed += 1
  }
  return completed
}
