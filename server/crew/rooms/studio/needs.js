import { verdictPassed } from '../../../../shared/judgment.js'
import { dispatchFrom } from '../../assignment-projections.js'
import { memberDisplayName } from '../../member-labels.js'
import { commandEvidenceFor, latestAutoCheck, latestReviewTimeout, manualEvidenceFor, manualReviewState, reviewState, reworkFloor, verifierIds } from './verifiers.js'
import { AUTO_CHECK_STATUS, PLANNER_DECISION_KIND, REVIEW_STATE, STAGE_STATE } from '../../../../shared/states.js'
import { DECISION_STATUS } from '../../../../shared/decision.js'

const latestForStage = (messages, kind, stage, after = -1) => [...messages]
  .reverse()
  .find(message => (
    message.kind === kind &&
    (message.meta?.stage ?? 0) === stage &&
    (message.seq ?? 0) > after
  ))

// 基座的 working 标记有时比工具活动晚一拍；最近的工具活动也算这一回合还在跑。
// 只用来压掉基于旧证据的“验收员在看/待重做”，不压人的交接、阻塞和超时。
const RECENT_ACTIVITY_MS = 2 * 60_000
const recentlyActive = (room, messages) => {
  if ((room.turnQueue ?? []).some(item => item?.state === 'running')) return true
  const now = Date.now()
  return messages.some(message => (
    message.kind === 'activity' &&
    Number.isFinite(message.ts) &&
    now - message.ts < RECENT_ACTIVITY_MS
  ))
}

export const studioNeedsYou = (room, messages = []) => {
  const index = (Array.isArray(room.stages) ? room.stages : []).findIndex(stage => stage.state === STAGE_STATE.active)
  if (index < 0) return null
  const stage = room.stages[index]
  const floor = reworkFloor(messages, index)

  if (room.pendingDecision?.status === DECISION_STATUS.open) {
    return {
      kind: 'decision',
      stage: Number.isInteger(room.pendingDecision.stage) ? room.pendingDecision.stage : index,
      label: room.pendingDecision.question,
      detail: '选一条路继续。',
      decisionId: room.pendingDecision.id,
    }
  }
  if (typeof room.openQuestion === 'string' && room.openQuestion.trim() !== '') {
    return { kind: 'question', stage: index, label: room.openQuestion.trim(), detail: '在下面回复后继续。' }
  }
  if ((room.busyMembers ?? []).length > 0) return null
  // 规划师把这一步交给人以后，下一步是人拍板，不再显示“待重做”。
  const handoff = room.lastPlannerDecision
  if (handoff?.stage === index && handoff?.kind === PLANNER_DECISION_KIND.human) {
    const latestVerdict = latestForStage(messages, 'verdict', index, floor)
    if (latestVerdict !== undefined && (latestVerdict.id ?? latestVerdict.seq) === handoff.verdictId) {
      const judgment = handoff.judgment ?? {}
      return {
        kind: 'decision',
        stage: index,
        label: '规划师把这一步交给你',
        detail: judgment.actionRequired || judgment.reason || '',
      }
    }
  }
  const auto = room.autoCheck
  if (auto?.stage === index && (auto.status === AUTO_CHECK_STATUS.blocked || auto.status === AUTO_CHECK_STATUS['limit-reached'])) {
    return {
      kind: 'auto-check',
      stage: index,
      label: auto.status === AUTO_CHECK_STATUS['limit-reached']
        ? '这一步还没做成，可以再试一次'
        : '这一步没做成，待你决定',
    }
  }
  const timeout = latestReviewTimeout(messages, index)
  if (timeout !== undefined) {
    const lastVerdict = latestForStage(messages, 'verdict', index, floor)
    const lastRework = latestForStage(messages, 'rework', index)
    if (
      (timeout.ts ?? 0) > (room.reviewRetriedAt ?? 0) &&
      (timeout.ts ?? 0) > (lastVerdict?.ts ?? 0) &&
      (timeout.ts ?? 0) > (lastRework?.ts ?? 0)
    ) {
      const names = (Array.isArray(timeout.meta?.verifiers) ? timeout.meta.verifiers : [])
        .map(id => memberDisplayName(room, id)).join('、')
      return {
        kind: 'review-timeout',
        stage: index,
        label: names === '' ? '复核没按时回来' : `${names}的复核没按时回来`,
        detail: room.independence === 'none'
          ? '只有一家厂商，复核其实是自查；再装一个 Agent 才算独立复核。'
          : '可以再叫一次复核，或退回重做。',
      }
    }
  }
  if (stage.manual === true) {
    const manual = manualEvidenceFor(room, undefined, messages, index)
    const auto = latestAutoCheck(messages, index, floor)
    if (auto !== undefined && auto.meta?.exit !== 0 && (manual === undefined || (auto.seq ?? 0) > (manual.seq ?? 0))) {
      return recentlyActive(room, messages) ? null : { kind: 'rework', stage: index, label: '自动检查没通过，先重做' }
    }
    if (manual?.meta?.kind !== 'manual') return null
    if (verifierIds(room).length > 0) {
      const outcome = manualReviewState({ room, messages, stageIndex: index })
      const active = recentlyActive(room, messages)
      if (outcome.state === 'reject') return active ? null : { kind: 'rework', stage: index, label: '待重做' }
      if (outcome.state === REVIEW_STATE.pending) {
        return active ? null : { kind: 'review', stage: index, label: '验收员在看', detail: '验收员还在核对结果。', actionable: false }
      }
      if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '', actionable: false }
      return null
    }
    return { kind: 'confirm', stage: index, label: '待确认' }
  }
  // 目标对齐和验收与结论是脊柱阶段，系统会自己推进；它们 active 时不是人要做决定。
  if (stage.spine === true) return null
  if (stage.kind === 'decision') return { kind: 'confirm', stage: index, label: '待确认' }

  if (typeof stage.acceptance !== 'string' || stage.acceptance.trim() === '') {
    return {
      kind: 'setup',
      stage: index,
      label: '待补检查',
      detail: '给这一步补一条能跑的检查，或改成你看结果。',
    }
  }
  const dispatch = dispatchFrom(room.assignments ?? [], index)
  if (room.mergeConflict?.stage === index || (dispatch?.stage === index && dispatch?.conflict !== undefined && dispatch?.conflict !== null)) {
    return { kind: 'merge', stage: index, label: '合并冲突' }
  }
  if (dispatch?.stage === index && dispatch?.stalled === true) {
    const names = (dispatch.pending ?? []).map(id => memberDisplayName(room, id)).join('、')
    return {
      kind: 'parallel',
      stage: index,
      label: names === '' ? '并行执行没有产出' : `${names}卡住了，没有产出`,
      detail: '退回重做，或只留一位执行官继续。',
    }
  }
  if (dispatch?.stage === index && dispatch?.timedOut === true) {
    const names = (dispatch.pending ?? []).map(id => memberDisplayName(room, id)).join('、')
    return {
      kind: 'parallel',
      stage: index,
      label: names === '' ? '并行执行超时' : `${names}并行执行超时`,
      detail: '退回重做，或只留一位执行官继续。',
    }
  }
  const commandEvidence = commandEvidenceFor(room, undefined, messages, index)
  if (commandEvidence !== undefined && commandEvidence.meta?.exit !== 0) {
    return recentlyActive(room, messages) ? null : { kind: 'rework', stage: index, label: '待重做' }
  }
  if (verifierIds(room).length > 1) {
    const outcome = reviewState({ room, messages, stageIndex: index })
    const active = recentlyActive(room, messages)
    if (outcome.state === 'reject') return active ? null : { kind: 'rework', stage: index, label: '待重做' }
    if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '', actionable: false }
    if (outcome.state === REVIEW_STATE.pending) {
      return active ? null : { kind: 'review', stage: index, label: '验收员在看', detail: '验收员还在核对结果。', actionable: false }
    }
    return null
  }
  const verdict = latestForStage(messages, 'verdict', index, floor)
  if (verdict !== undefined && verdictPassed(verdict)) return { kind: 'signoff', stage: index, label: '', actionable: false }
  if (verdict !== undefined) return recentlyActive(room, messages) ? null : { kind: 'rework', stage: index, label: '待重做' }
  if (latestForStage(messages, 'evidence', index, floor) !== undefined) {
    if (recentlyActive(room, messages)) return null
    return verifierIds(room).length > 0
      ? { kind: 'review', stage: index, label: '验收员在看', actionable: false }
      : { kind: 'confirm', stage: index, label: '待确认' }
  }
  return null
}
