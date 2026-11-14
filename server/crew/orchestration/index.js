import * as pipeline from './pipeline.js'

export { resolveAssigneeTokens } from './assignees.js'

export const defaultOrchestrationId = pipeline.id

export const resolveOrchestration = value => {
  const raw = typeof value === 'string' ? value.trim() : value
  if (raw === undefined || raw === null || raw === '' || raw === pipeline.id) return pipeline
  return null
}

export const listOrchestrations = () => [{
  id: pipeline.id,
  name: pipeline.name,
  description: pipeline.description,
}]

// 一期只有一条流水线：一个阶段派一个执行席位。
export const planDispatch = ({ stage, workers }) => {
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(seat => workers.includes(seat))
    : []
  return {
    strategy: pipeline,
    assignees: proposed.length > 0 ? proposed.slice(0, 1) : workers.slice(0, 1),
    parallel: false,
    note: proposed.length > 1 ? '流水线一次只派一个执行席位；其余席位留到后续阶段。' : '',
  }
}

export const reviewGuidanceFor = () => ''
