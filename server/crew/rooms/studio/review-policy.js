import { verdictPassed } from '../../../../shared/judgment.js'
import { reworkFloor } from '../../../../shared/attempt.js'
import { ROOM_STATE, STAGE_STATE } from '../../../../shared/states.js'
import { FINAL_TITLE } from './stage-plan.js'

// 影子评审按需出现：检查很弱、之前被退回、改动面大或碰到配置时，才请它看一眼。
const WEAK_ACCEPTANCE = /^\s*(true|test\s+-[edf]\b)/i
const CONFIG_FILE = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile|\.env[^/]*|[^/]*\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|[^/]*\.ya?ml)$/i

export const shadowNeeded = ({ room, stage, evidence, manual, messages = [], stageIndex = null }) => {
  if (room?.shadowReview === true) return true
  if (manual === true) return true
  const command = typeof stage?.acceptance === 'string' ? stage.acceptance.trim() : ''
  if (command === '' || WEAK_ACCEPTANCE.test(command)) return true
  const files = Array.isArray(evidence?.meta?.changedFiles) ? evidence.meta.changedFiles : []
  if (files.length >= 5) return true
  if (files.some(file => CONFIG_FILE.test(file))) return true
  const rejected = (messages ?? []).some(message => (
    message.kind === 'verdict' &&
    (stageIndex === null || (message.meta?.stage ?? 0) === stageIndex) &&
    !verdictPassed(message)
  ))
  return rejected
}

// 中间步骤验收通过就继续；最后一步仍由人收下这一轮的交付。
export const hasLaterWorkStage = (room, index) => (Array.isArray(room?.stages) ? room.stages : [])
  .slice(index + 1)
  .some(stage => stage.title !== FINAL_TITLE)

// 超时后晚到的判定只在这条复核仍然对应当前这一步、当前证据时才算数。
export const lateReviewStillValid = ({ room, messages, pending }) => {
  if (room === null || room.state !== ROOM_STATE.active) return false
  const active = (room.stages ?? []).findIndex(stage => stage.state === STAGE_STATE.active)
  if (active !== pending.stage) return false
  const floor = reworkFloor(messages, pending.stage)
  const latestEvidence = [...messages].reverse().find(message => (
    message.kind === 'evidence' &&
    (message.meta?.stage ?? 0) === pending.stage &&
    (message.seq ?? 0) > floor
  ))
  if (latestEvidence?.id !== pending.evidenceId) return false
  return !messages.some(message => (
    (message.kind === 'rework' || message.kind === 'rewind') &&
    (message.meta?.stage ?? 0) === pending.stage &&
    (message.ts ?? 0) > (pending.requestedAt ?? 0)
  ))
}
