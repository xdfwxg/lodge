import { normalizeJudgment } from '../../../../shared/judgment.js'
import { STAGE_STATE } from '../../../../shared/states.js'

export const isWorkStage = stage => stage.kind === 'deliverable' || stage.manual === true

export const activeStageReadOnly = room => (
  room?.stages?.find(stage => stage.state === STAGE_STATE.active)?.readOnly === true
)

export const deliverableStageIndex = room => {
  const active = room.stages.findIndex(stage => stage.state === STAGE_STATE.active && isWorkStage(stage))
  if (active >= 0) return active
  const pending = room.stages.findIndex(stage => stage.state === STAGE_STATE.pending && isWorkStage(stage))
  if (pending >= 0) return pending
  const first = room.stages.findIndex(stage => isWorkStage(stage))
  return first >= 0 ? first : 0
}

export const memberForRef = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const member of room?.members ?? []) {
    if (member?.body?.ref === ref) return member.id
  }
  return null
}

// 旧调用方仍可拿到布尔/kind；解析本身已经归 shared/judgment.js 的契约。
export const parseVerdict = reply => (
  normalizeJudgment({ type: 'verdict', text: reply }).decision === 'pass'
)

export const parsePlannerDecision = reply => {
  const judgment = normalizeJudgment({ type: 'planner', text: reply })
  return { kind: judgment.decision, note: judgment.reason }
}

export const tail = (text, limit) => {
  const value = String(text ?? '')
  return value.length > limit ? `…\n${value.slice(-limit)}` : value
}

export const PARALLEL_TIMEOUT = 15 * 60_000
// 单个成员先到期，阶段截止仍留作整步兜底；两者不能反过来。
export const ASSIGNMENT_LEASE = 8 * 60_000
export const REVIEW_TIMEOUT = 10 * 60_000
export const REVIEW_REMINDER = 2 * 60_000
