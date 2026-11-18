// 人工卡的有效期：一张卡只属于产生它的阶段和重做轮次。
// 对齐 LoopForge cards.go 的 run/node/attempt 绑定（MIT）；Lodge 的 attempt = stage + rework floor。
export const reworkFloor = (messages, stageIndex) => (
  (Array.isArray(messages) ? messages : []).reduce((floor, message) => (
    message?.kind === 'rework' && (message?.meta?.stage ?? 0) === stageIndex
      ? Math.max(floor, message.seq ?? 0)
      : floor
  ), -1)
)

const taskOf = (room, stage, memberId = null) => {
  const tasks = room?.stages?.[stage]?.tasks
  if (!Array.isArray(tasks) || tasks.length === 0) return null
  if (typeof memberId === 'string' && memberId !== '') {
    return tasks.filter(task => task?.owner === memberId).at(-1) ?? null
  }
  return tasks.at(-1)
}

const assignmentOf = task => {
  const id = task?.assignmentId ?? task?.id
  return typeof id === 'string' && id !== '' ? id : null
}

export const attemptScopeOf = ({ room, messages = [], memberId = null }) => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const stage = stages.findIndex(item => item?.state === 'active')
  if (stage < 0) return { stage: null, floor: -1, assignment: null }
  return {
    stage,
    floor: reworkFloor(messages, stage),
    assignment: assignmentOf(taskOf(room, stage, memberId)),
  }
}

export const scopeIsValid = (scope, { room, messages = [] }) => {
  if (scope === null || scope === undefined) return true
  if (!Number.isInteger(scope.stage)) return true
  const current = attemptScopeOf({ room, messages })
  if (current.stage !== scope.stage || current.floor !== scope.floor) return false
  if (typeof scope.assignment === 'string' && scope.assignment !== '') {
    const tasks = room?.stages?.[scope.stage]?.tasks
    return Array.isArray(tasks) && tasks.some(task => assignmentOf(task) === scope.assignment)
  }
  return true
}

export const answeredCardIds = (room, messages = []) => {
  const ids = new Set(Array.isArray(room?.cardAnswers) ? room.cardAnswers : [])
  for (const message of Array.isArray(messages) ? messages : []) {
    if (
      message?.kind === 'system' &&
      message?.meta?.kind === 'card-answered' &&
      typeof message.meta.requestId === 'string'
    ) {
      ids.add(message.meta.requestId)
    }
  }
  return ids
}

export const cardStateOf = (room, message, messages = []) => {
  const requestId = message?.meta?.card?.requestId
  if (typeof requestId === 'string' && answeredCardIds(room, messages).has(requestId)) return 'answered'
  if (!scopeIsValid(message?.meta?.card?.scope, { room, messages })) return 'stale'
  return 'open'
}

// 卡片只暴露当前可用动作；界面不再各自判断。
export const cardActionsOf = ({ kind, state }) => {
  if (kind === 'question' && state === 'open') return ['answer']
  if (kind === 'approval' && state === 'pending') return ['allow', 'deny']
  return []
}
