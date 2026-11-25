import { AUTO_CHECK_STATUS, CHAT_PHASE, CHAT_STATUS, OPEN_ROUND_STATUSES, PLANNER_DECISION_KIND, ROOM_STATE, ROOM_STATUS, ROUND_STATUS, STAGE_STATUS } from './states.js'

// 房间状态和轮次状态是两层事实；界面不再用一个 complete 同时表示两者。
export const roomStatusOf = room => {
  if (room?.archivedAt) return ROOM_STATUS.archived
  if (room?.state === ROOM_STATE.paused) return ROOM_STATUS.paused
  if (room?.state === ROOM_STATE.stopped) return ROOM_STATUS.stopped
  if (room?.state === ROOM_STATE.active || (typeof room?.activeRoundId === 'string' && room.activeRoundId !== '')) return ROOM_STATUS.active
  return ROOM_STATUS.idle
}

export const roundStatusOf = value => value?.workRound?.status ?? value?.status ?? null

export const roundOpen = value => OPEN_ROUND_STATUSES.has(roundStatusOf(value))

// 只有正在跑的房不能直接删：聊天室看讨论是否在跑，工作室看这一轮是否还开着。
// 聊完了、交付了、停住了都能直接删；归档只是收起来，不是删除的前提。
export const roomDeletableNow = room => {
  if (room?.archivedAt) return true
  if (room?.roomType === 'chat' || room?.chat !== undefined) {
    return room?.chat?.running !== true && room?.chat?.hostThinking !== true
  }
  return !roundOpen(room)
}

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
  if (stage.state === STAGE_STATUS.passed) return STAGE_STATUS.passed
  if (stage.state === STAGE_STATUS.pending) return STAGE_STATUS.pending
  if (room?.mergeConflict?.stage === index) return STAGE_STATUS.blocked
  if (room?.blocked?.stage === index) return STAGE_STATUS.blocked
  if (typeof room?.openQuestion === 'string' && room.openQuestion.trim() !== '') return STAGE_STATUS.waiting
  if (room?.autoCheck?.stage === index && [AUTO_CHECK_STATUS.blocked, AUTO_CHECK_STATUS['limit-reached']].includes(room.autoCheck.status)) return STAGE_STATUS.waiting
  if (room?.lastPlannerDecision?.stage === index && room.lastPlannerDecision.kind === PLANNER_DECISION_KIND.human) return STAGE_STATUS.waiting
  return STAGE_STATUS.active
}

// 聊天室只有两种交互模式：开放聊天，或一个临时讨论轮。
export const chatModeOf = room => (
  room?.chat?.phase === CHAT_PHASE.discussing || room?.chat?.phase === CHAT_PHASE.summarizing
    ? 'round'
    : 'open'
)

// 工作室的一轮是否已经走完所有阶段；聊天室也有只读阶段，所以只按阶段事实判断。
export const stagesCompletedOf = room => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  return stages.length > 0 && stages.every(stage => stage.state === STAGE_STATUS.passed)
}

// 聊天有没有真正开始：运行标志、总结/收尾阶段，或已经有人说了一句。
export const chatStartedOf = (room, messages = room?.messages) => {
  const chat = room?.chat ?? {}
  if (chat.selecting === true || chat.running === true || chat.hostThinking === true) return true
  if (chat.phase === CHAT_PHASE.summarizing || chat.phase === CHAT_PHASE.concluded) return true
  return (Array.isArray(messages) ? messages : []).some(message => (
    message.kind === 'chat' && message.authorId !== 'lodge' && message.authorId !== 'system'
  ))
}

// 聊天室“现在在做什么”：先把房间暂停/停止、讨论、总结、收尾合成一个词。
export const chatStatusOf = (room, messages = room?.messages) => {
  if (room?.archivedAt) return CHAT_STATUS.archived
  if (room?.state === ROOM_STATE.paused) return CHAT_STATUS.paused
  if (room?.state === ROOM_STATE.stopped) return CHAT_STATUS.stopped
  const chat = room?.chat ?? {}
  if (chat.phase === CHAT_STATUS.summarizing) return CHAT_STATUS.summarizing
  if (chat.phase === CHAT_STATUS.concluded) return CHAT_STATUS.concluded
  if (chat.selecting === true) return CHAT_STATUS.selecting
  if (chat.hostThinking === true) return CHAT_STATUS.thinking
  if (chat.running === true) return CHAT_STATUS.running
  // 停下/出错后这一轮没有结论，但也没结束；界面要能看见并继续，不能装成还在聊。
  if (chat.interrupted === true) return CHAT_STATUS.paused
  return chatStartedOf(room, messages) ? CHAT_STATUS.discussing : CHAT_STATUS.idle
}
