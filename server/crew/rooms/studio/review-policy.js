import { reworkFloor } from '../../../../shared/attempt.js'
import { ROOM_STATE, STAGE_STATE } from '../../../../shared/states.js'
import { FINAL_TITLE } from './stage-plan.js'

// 中间步骤验收通过就继续；最后一步验收通过就是交付，不再等人确认。
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
