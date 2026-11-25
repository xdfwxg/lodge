import { judgmentOf, verdictPassed } from '../../../../shared/judgment.js'
import { resultEvidenceFor, reviewState, reworkFloor } from './verifiers.js'
import { verifierIds } from '../../room-members.js'
import { REVIEW_STATE, STAGE_STATE } from '../../../../shared/states.js'

const deny = (reason, error) => ({ ok: false, reason, error })

// PASS 不能只说“没问题”；要给出 diff 之外最值得担心的一条风险，没有就写「无」。
// 文本判定由复核协调器要求同一字段；这里兜结构化记录，避免别的入口漏过。
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
  // 包外改动是写边界的事实：能退回的必须已经退回，退不回的（非 git 副本）不能确认。
  const outside = found.meta?.outOfBounds
  const outsideFiles = Array.isArray(outside?.files) ? outside.files : []
  const reverted = Array.isArray(outside?.reverted) ? outside.reverted : []
  if (outsideFiles.length > 0 && reverted.length < outsideFiles.length) {
    return deny('conflict', `这一步改过工作包之外的文件：${outsideFiles.slice(0, 5).join('、')}；先处理再验收。`)
  }
  // 每个交付都要有能重跑的证明；证明在改动前也绿，就没有绑定这次改动。
  if (found.meta?.proof?.status === 'incomplete') {
    const missing = Array.isArray(found.meta.proof.missingClauses) ? found.meta.proof.missingClauses : []
    return deny('conflict', `交付证明没有覆盖每条契约要求${missing.length === 0 ? '' : `：${missing.join('、')}`}；每条要求至少要有一条平台跑过的 step。`)
  }
  if (found.meta?.proof?.status === 'failed' && typeof found.meta.proof.error === 'string' && found.meta.proof.error !== '') {
    return deny('conflict', `交付证明没跑绿：${found.meta.proof.error}`)
  }
  if (found.meta?.proof?.status !== 'verified') {
    return deny('conflict', '交付没有可重跑的证明，不能确认；先让执行官补 lodge-proof.json')
  }
  if (found.meta?.proof?.weak === true) {
    return deny('conflict', '交付的证明在改动前也通过，不能证明这一步；补一条会先在旧版本失败的检查，或把这一步标成“行为不变”。')
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
