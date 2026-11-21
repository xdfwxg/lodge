import { OPEN_ROUND_STATUSES, ROUND_STATUS } from './work-round.js'

// 房间状态和轮次状态是两层事实；界面不再用一个 complete 同时表示两者。
export const roomStatusOf = room => {
  if (room?.archivedAt) return 'archived'
  if (room?.state === 'paused') return 'paused'
  if (room?.state === 'stopped') return 'stopped'
  if (room?.state === 'active' || (typeof room?.activeRoundId === 'string' && room.activeRoundId !== '')) return 'active'
  return 'idle'
}

export const roundStatusOf = value => value?.workRound?.status ?? value?.status ?? null

export const roundOpen = value => OPEN_ROUND_STATUSES.has(roundStatusOf(value))

export const deliveredRoundOf = room => {
  if (roundStatusOf(room) === ROUND_STATUS.completed) return room.workRound ?? null
  const rounds = Array.isArray(room?.rounds) ? room.rounds : []
  return [...rounds].reverse().find(round => round?.status === ROUND_STATUS.completed) ?? null
}

export const roundDelivered = room => deliveredRoundOf(room) !== null
