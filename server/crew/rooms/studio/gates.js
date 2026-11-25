import { judgmentOf, verdictPassed } from '../../../../shared/judgment.js'
import { resultEvidenceFor, reviewState, reworkFloor } from './verifiers.js'
import { verifierIds } from '../../room-members.js'
import { REVIEW_STATE, STAGE_STATE } from '../../../../shared/states.js'

const deny = (reason, error) => ({ ok: false, reason, error })

// PASS 不能只说“没问题”；要给出 diff 之外最值得担心的一条风险，没有就写「无」。
// 走文本兜底的判定没有结构化字段，不在这里拦。
const missingOutsideDiff = message => {
  const judgment = judgmentOf(message)
  return judgment !== null &&
    judgment.decision === 'pass' &&
    judgment.source !== 'text' &&
    judgment.outsideDiff === ''
}

// 完成 = 验收员通过。平台只检查“有结果、有判定、判定对得上这次结果”，
// 不规定验收员该跑什么、该看什么。
export const gateFor = (room, index, messages, evidence) => {
  const stage = Number.isInteger(index) ? room.stages[index] : undefined
  if (stage === undefined) return deny('invalid', '没有这个阶段')
  if (stage.state !== STAGE_STATE.active) return deny('conflict', '这个阶段不在待验收状态')
  const dependency = (Array.isArray(stage.dependsOn) ? stage.dependsOn : [])
    .find(item => room.stages[item]?.state !== STAGE_STATE.passed)
  if (dependency !== undefined) return deny('conflict', `先完成阶段 ${dependency + 1}，再验收这一阶段`)
  if (room.openQuestion !== null && room.openQuestion !== undefined) {
    return deny('conflict', '还有问题没回答，回答后再继续')
  }
  const ordered = Array.isArray(messages) ? messages : []
  const floor = reworkFloor(ordered, index)
  const missingRisk = ordered.find(message => (
    message.kind === 'verdict' &&
    (message.meta?.stage ?? 0) === index &&
    (message.seq ?? 0) > floor &&
    verdictPassed(message) &&
    missingOutsideDiff(message)
  ))
  if (missingRisk !== undefined) {
    return deny('conflict', '验收结论缺少 diff 之外的一条风险；没有就写「无」，再签。')
  }
  const found = resultEvidenceFor(room, evidence, ordered, index)
  if (found === undefined) {
    return deny('conflict', '执行官还没有交回结果，不能验收')
  }
  // 有契约的房间必须有可重跑证明；旧房间没有契约时不改变原来的判定。
  if (room.plan?.contract !== null && room.plan?.contract !== undefined &&
    found.meta?.proof?.status !== 'verified') {
    return deny('conflict', '交付没有可重跑的证明，不能确认；先让执行官补 lodge-proof.json')
  }
  const latestVerdict = ordered.filter(message => (
    message.kind === 'verdict' && (message.meta?.stage ?? 0) === index && (message.seq ?? 0) > floor
  )).at(-1)
  if (latestVerdict !== undefined && !verdictPassed(latestVerdict)) {
    return deny('conflict', '验收员退回了，先重做再交一次')
  }
  const ids = verifierIds(room)
  if (ids.length === 0) return { ok: true, stage }
  const outcome = reviewState({ room, evidence, messages: ordered, stageIndex: index })
  if (outcome.state === REVIEW_STATE.pass) return { ok: true, stage }
  if (outcome.state === REVIEW_STATE.reject) return deny('conflict', '验收员退回了，先重做再交一次')
  if (outcome.state === REVIEW_STATE.pending) return deny('conflict', '还有验收员没有回报，不能确认')
  return deny('conflict', '本轮结果还没有验收通过，不能确认')
}
