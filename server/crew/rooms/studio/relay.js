// 工作室的默认接力是代码决定的：规划师 → 执行官 → 验收员 → 通过回规划师 / 不通过回执行官。
// 模型只提供内容；谁接下一棒由这里回答，避免靠模型记得 @ 谁。
export const MAX_STAGE_REWORKS = 3

export const relayAfterVerdict = ({
  pass,
  reworksUsed = 0,
  mergeConflict = false,
  targets = [],
  max = MAX_STAGE_REWORKS,
}) => {
  if (pass) return { kind: 'summary', to: 'planner' }
  if (mergeConflict) return { kind: 'human', to: 'planner', reason: 'merge-conflict' }
  if (reworksUsed >= max) return { kind: 'human', to: 'planner', reason: 'rework-budget' }
  if (targets.length === 0) return { kind: 'human', to: 'planner', reason: 'no-executor' }
  return { kind: 'rework', to: 'executor', targets }
}
