import * as critique from './critique.js'
import * as pipeline from './pipeline.js'
import * as parallel from './parallel.js'

export { resolveAssigneeTokens } from './assignees.js'

const orchestrationStrategies = [pipeline, parallel, critique]
export const defaultOrchestrationId = pipeline.id

export const resolveOrchestration = value => {
  const raw = typeof value === 'string' ? value.trim() : value
  if (raw === undefined || raw === null || raw === '') return pipeline
  return orchestrationStrategies.find(item => item.id === raw) ?? null
}

// 编排层对外只暴露两个决定：这一阶段怎么派、验收要补什么要求。
export const planDispatch = ({ room, stage, index, workers }) => {
  const strategy = resolveOrchestration(room?.orchestration) ?? resolveOrchestration()
  const plan = strategy.planStage({ room, stage, index, workers })
  const assignees = plan.assignees.filter(worker => workers.includes(worker))
  const parallel = plan.parallel === true
  if (!parallel && assignees.length > 1) {
    throw new Error(`这次分配没法同时派给多人，先按顺序做`)
  }
  return {
    strategy,
    assignees,
    parallel,
    note: typeof plan.note === 'string' ? plan.note : '',
  }
}

export const reviewGuidanceFor = room => resolveOrchestration(room?.orchestration)?.reviewGuidance ?? ''
