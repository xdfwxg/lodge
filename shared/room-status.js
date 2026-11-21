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

// “现在就是已交付”：房间已经空下来，且最近一轮完成。
// 新一轮在跑时，上一轮的完成只是历史，不是当前状态。
export const idleDelivered = room => {
  if (roomStatusOf(room) !== 'idle') return false
  const status = roundStatusOf(room) ?? (Array.isArray(room?.rounds) && room.rounds.length > 0 ? room.rounds.at(-1)?.status : null)
  return status === ROUND_STATUS.completed
}

// 工作室“这一步现在算什么”：阶段状态加房间上的阻塞和人要处理的事，一次算清。
export const stageStatusOf = (room, index) => {
  const stage = room?.stages?.[index]
  if (stage === undefined) return null
  if (stage.state === 'passed') return 'passed'
  if (stage.state === 'pending') return 'pending'
  if (room?.mergeConflict?.stage === index) return 'blocked'
  if (room?.blocked?.stage === index) return 'blocked'
  if (typeof room?.openQuestion === 'string' && room.openQuestion.trim() !== '') return 'waiting'
  if (room?.autoCheck?.stage === index && ['blocked', 'limit-reached'].includes(room.autoCheck.status)) return 'waiting'
  if (room?.lastPlannerDecision?.stage === index && room.lastPlannerDecision.kind === 'human') return 'waiting'
  return 'active'
}

// 聊天室“现在在做什么”：先把房间暂停/停止、讨论、总结、收尾合成一个词。
export const chatStatusOf = (room, messages = room?.messages) => {
  if (room?.state === 'paused') return 'paused'
  if (room?.state === 'stopped') return 'stopped'
  const chat = room?.chat ?? {}
  if (chat.phase === 'summarizing') return 'summarizing'
  if (chat.phase === 'concluded') return 'concluded'
  if (chat.hostThinking === true) return 'thinking'
  if (chat.running === true) return 'running'
  const started = (Array.isArray(messages) ? messages : []).some(message => (
    message.kind === 'chat' && message.authorId !== 'lodge' && message.authorId !== 'system'
  ))
  return started ? 'discussing' : 'idle'
}
