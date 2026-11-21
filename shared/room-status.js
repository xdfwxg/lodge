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

// “现在就是已交付”：房间已经空下来，且最近一轮完成。
// 新一轮在跑时，上一轮的完成只是历史，不是当前状态。
export const idleDelivered = room => {
  if (roomStatusOf(room) !== 'idle') return false
  const status = roundStatusOf(room) ?? (Array.isArray(room?.rounds) && room.rounds.length > 0 ? room.rounds.at(-1)?.status : null)
  return status === ROUND_STATUS.completed
}
