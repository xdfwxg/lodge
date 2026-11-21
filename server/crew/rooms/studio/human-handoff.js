import { STAGE_STATE } from '../../../../shared/states.js'

// 规划师把某一步交给人时，下一步输入应该回到这一步，而不是只在群里叫醒规划师聊天。
export const humanHandoffStageOf = (room, messages = []) => {
  const index = (Array.isArray(room?.stages) ? room.stages : []).findIndex(stage => stage.state === STAGE_STATE.active)
  if (index < 0) return null
  const decision = room.lastPlannerDecision
  if (decision?.stage !== index || decision?.kind !== 'human') return null
  const latest = [...(Array.isArray(messages) ? messages : [])].reverse()
    .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === index)
  if (latest === undefined) return null
  return (latest.id ?? latest.seq) === decision.verdictId ? index : null
}
