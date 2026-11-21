import { memberDisplayName } from '../../member-labels.js'
import { judgmentOf, verdictPassed } from '../../../../shared/judgment.js'
import { latestAutoCheck, manualEvidenceFor, manualReviewState, reviewState, reworkFloor, verifierIds } from './verifiers.js'
import { tddIssueOf } from './tdd.js'
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

export const gateFor = (room, index, messages, evidence) => {
  const ledger = Array.isArray(evidence)
    ? evidence
    : messages.filter(message => (
      message.kind === 'evidence' && (message.meta?.kind === 'command' || message.meta?.kind === 'manual')
    ))
  const stage = Number.isInteger(index) ? room.stages[index] : undefined
  if (stage === undefined) return deny('invalid', '没有这个阶段')
  if (stage.state !== STAGE_STATE.active) return deny('conflict', '这个阶段不在待验收状态')
  const dependency = (Array.isArray(stage.dependsOn) ? stage.dependsOn : [])
    .find(item => room.stages[item]?.state !== STAGE_STATE.passed)
  if (dependency !== undefined) return deny('conflict', `先完成阶段 ${dependency + 1}，再验收这一阶段`)
  if (room.openQuestion !== null && room.openQuestion !== undefined) {
    return deny('conflict', '还有问题没回答，回答后再继续')
  }
  const orderedMessages = Array.isArray(messages) ? messages : []
  const verdictFloor = reworkFloor(orderedMessages, index)
  const missingRisk = orderedMessages.find(message => (
    message.kind === 'verdict' &&
    (message.meta?.stage ?? 0) === index &&
    (message.seq ?? 0) > verdictFloor &&
    verdictPassed(message) &&
    missingOutsideDiff(message)
  ))
  if (missingRisk !== undefined) {
    return deny('conflict', '验收结论缺少 diff 之外的一条风险；没有就写「无」，再签。')
  }
  if (stage.manual === true) {
    // 只认本轮最新一条人工凭证；新的执行回合或重做会让旧凭证过期。
    const latestEvidence = manualEvidenceFor(room, ledger, messages, index)
    if (latestEvidence === undefined) return deny('conflict', '执行还没有产出，不能验收')
    // 产品自己跑的检查没通过时，这一步不交给人确认；先重做。
    const auto = latestAutoCheck(messages, index, reworkFloor(messages, index))
    if (auto !== undefined && auto.meta?.exit !== 0 && (auto.seq ?? 0) > (latestEvidence.seq ?? 0)) {
      return deny('conflict', '自动检查没通过，先重做')
    }
    if (verifierIds(room).length > 0) {
      const outcome = manualReviewState({ room, evidence: ledger, messages, stageIndex: index })
      if (outcome.state === 'reject') {
        const names = outcome.rejects.map(message => memberDisplayName(room, message.authorId)).join('、')
        return deny('conflict', `${names} 退回了，先重做再再交一次`)
      }
      if (outcome.state === REVIEW_STATE.pending) {
        const names = outcome.missing.map(id => memberDisplayName(room, id)).join('、')
        return deny('conflict', `还有验收员没有回报（${names}），不能确认`)
      }
      if (outcome.state !== 'pass') return deny('conflict', '本轮结果还没有验收通过，不能确认')
    }
    return { ok: true, stage }
  }
  if (stage.kind !== 'deliverable') return { ok: true, stage }
  const acceptance = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
  if (acceptance === '') {
    return deny('conflict', '交付型阶段还没有检查方式，不能验收')
  }
  const stageEvidence = ledger.filter(message => (
    (message.meta?.stage ?? 0) === index &&
    (message.seq ?? 0) > reworkFloor(messages, index)
  ))
  const tdd = room.demo === true ? '' : tddIssueOf(stage, stageEvidence.at(-1))
  if (tdd !== '') return deny('conflict', tdd)
  const isCommandEvidence = message => (
    message.meta?.stage === index &&
    (room.demo === true || message.meta?.simulated !== true) &&
    (message.meta?.kind === 'command' || (room.demo === true && message.meta?.simulated === true)) &&
    message.meta?.exit === 0 &&
    typeof message.meta?.command === 'string' &&
    message.meta.command.trim() === acceptance
  )

  const ordered = [...messages].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  if (verifierIds(room).length > 1) {
    const outcome = reviewState({ room, evidence: ledger, messages: ordered, stageIndex: index })
    if (outcome.state === 'reject') {
      const names = outcome.rejects.map(message => memberDisplayName(room, message.authorId)).join('、')
      return deny('conflict', `${names} 退回了，先重做并重新跑验收命令`)
    }
    if (outcome.state === 'failed') {
      const exit = outcome.evidence?.meta?.exit
      return deny('conflict', '最新检查没有通过，不能确认')
    }
    if (outcome.state === REVIEW_STATE.pending) {
      const names = outcome.missing.map(id => memberDisplayName(room, id)).join('、')
      return deny('conflict', `还有验收员没有回报（${names}），不能确认`)
    }
    if (outcome.state !== 'pass') {
      return deny('conflict', '本轮验收还没有全部通过，不能确认')
    }
    return { ok: true, stage }
  }
  const floor = reworkFloor(ordered, index)
  const verdicts = ordered.filter(message => (
    message.kind === 'verdict' &&
    message.meta?.stage === index &&
    (message.seq ?? 0) > floor
  ))
  const latest = verdicts.at(-1)
  const evidenceBetween = (floor, ceiling) => ledger.filter(message => (
    message.meta?.stage === index &&
    (room.demo === true || message.meta?.simulated !== true) &&
    (message.seq ?? 0) > floor &&
    (message.seq ?? 0) < ceiling
  ))

  if (latest === undefined) {
    const phaseEvidence = evidenceBetween(floor, Number.POSITIVE_INFINITY)
    if (phaseEvidence.length === 0) {
      return deny('conflict', '还没有本阶段的证据（检查记录或人工结果），不能验收')
    }
    if (!isCommandEvidence(phaseEvidence.at(-1))) {
      return deny('conflict', '还没有检查通过的记录，不能确认')
    }
    // 只有显式声明了“没有验收成员”的扩展编制才允许直接由人确认；未知成员表仍按有 verifier 处理。
    const hasVerifier = verifierIds(room).length > 0
    if (room.demo === true || hasVerifier) {
      return deny('conflict', room.demo === true ? '本阶段还没有验收通过，不能验收' : '还没有验收通过，不能确认')
    }
    return { ok: true, stage }
  }

  if (!verdictPassed(latest)) {
    return deny('conflict', '验收复核未通过，先重做')
  }

  // PASS 之前必须有一段“上一次 REJECT 之后”的新证据；否则只是口头翻案。
  const previousReject = [...verdicts].reverse().slice(1).find(message => !verdictPassed(message))
  const evidenceFloor = Math.max(floor, previousReject?.seq ?? -1)
  const phaseEvidence = evidenceBetween(evidenceFloor, latest.seq ?? Number.POSITIVE_INFINITY)
  if (phaseEvidence.length === 0) {
    return deny('conflict', previousReject === undefined ? '还没有本阶段的证据，不能验收' : '重做后还没有新的证据，不能验收')
  }
  const referenced = typeof latest.meta?.evidenceId === 'string'
    ? ledger.find(message => message.id === latest.meta.evidenceId)
    : undefined
  const covered = referenced !== undefined && (referenced.seq ?? 0) > evidenceFloor ? referenced : phaseEvidence.at(-1)
  if (!isCommandEvidence(covered)) {
    return deny('conflict', '复核没有对应的检查记录，不能确认')
  }
  return { ok: true, stage }
}
