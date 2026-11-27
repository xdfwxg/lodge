// 工作室这一步下一步该谁做：先人的决定，再这一步的证据，最后复核。
// 「停没停」的总规则在 crew/stop.js；这里只回答“工作室的阶段此刻缺什么”。
import { memberDisplayName } from '../../../member-labels.js'
import { dispatchFrom } from '../../../assignment-projections.js'
import { recentlyActive } from '../../../in-flight.js'
import { latestReviewTimeout, reviewState, reworkFloor, verifierIds } from '../acceptance/verifiers.js'
import { DECISION_STATUS } from '../../../../../shared/decision.js'
import { PLANNER_DECISION_KIND, REVIEW_STATE, STAGE_STATE } from '../../../../../shared/states.js'

const latestForStage = (messages, kind, stage, after = -1) => [...messages]
  .reverse()
  .find(message => (
    message.kind === kind &&
    (message.meta?.stage ?? 0) === stage &&
    (message.seq ?? 0) > after
  ))

export const studioStop = (room, messages = []) => {
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
  // 复核已经结束（超时或没给出有效结论）时，先让人看见它——哪怕成员的忙碌标记还没刷新掉。
  const timeout = latestReviewTimeout(messages, index)
  const plannerHandoff = room.lastPlannerDecision?.stage === index &&
    room.lastPlannerDecision?.kind === PLANNER_DECISION_KIND.human
  if (!plannerHandoff && stage.spine !== true && timeout !== undefined) {
    const lastVerdict = latestForStage(messages, 'verdict', index, floor)
    const lastRework = latestForStage(messages, 'rework', index)
    if (
      (timeout.ts ?? 0) > (room.reviewRetriedAt ?? 0) &&
      (timeout.ts ?? 0) > (lastVerdict?.ts ?? 0) &&
      (timeout.ts ?? 0) > (lastRework?.ts ?? 0)
    ) {
      const names = [...new Set(Array.isArray(timeout.meta?.verifiers) ? timeout.meta.verifiers : [])]
        .map(id => memberDisplayName(room, id)).join('、')
      const invalid = timeout.meta?.reason === 'invalid'
      return {
        kind: 'review-timeout',
        stage: index,
        label: invalid
          ? '复核没有给出有效结论'
          : names === '' ? '复核没按时回来' : `${names}的复核没按时回来`,
        detail: invalid
          ? '可以再叫一次复核，或退回重做。'
          : room.independence === 'none'
            ? '只有一家厂商，复核其实是自查；再装一个 Agent 才算独立复核。'
            : '可以再叫一次复核，或退回重做。',
      }
    }
  }
  // 成员还在忙时，这一步没有轮到人来决定。
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
  // 目标对齐和验收与结论是脊柱阶段，系统会自己推进；它们 active 时不是人要做决定。
  if (stage.spine === true) return null
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
  // 这一步的交接已经失败（回合被停下、没有产出）、也没有谁在跑：给一个能点的出路。
  // 只留一句“待处理”的房间等于停住了却交不回人手里。
  const failed = (Array.isArray(room.assignments) ? room.assignments : [])
    .filter(item => item.stageIndex === index && item.status === 'failed' &&
      ['dispatch', 'rework', 'retry'].includes(item.reason))
    .at(-1)
  const hasResult = (Array.isArray(messages) ? messages : []).some(message => (
    message.kind === 'evidence' && (message.meta?.stage ?? 0) === index && (message.seq ?? 0) > floor
  ))
  if (failed !== undefined && !hasResult) {
    const name = memberDisplayName(room, failed.toMemberId)
    return {
      kind: 'blocked',
      stage: index,
      label: `${name}这一回合没有跑完`,
      detail: '再派一次，或退回重做这一步。',
    }
  }
  if (verifierIds(room).length === 0) return null
  const outcome = reviewState({ room, messages, stageIndex: index })
  const active = recentlyActive(room, messages, index)
  // 退回之后平台自己会派返工：只要那一笔账已经落下（rework 消息），这一步就不该出现“待人”的卡。
  // 没落下才说明路由没走通——那时才让人看见“待重做”。
  if (outcome.state === 'reject') {
    if (active) return null
    return latestForStage(messages, 'rework', index) === undefined
      ? { kind: 'rework', stage: index, label: '待重做' }
      : null
  }
  if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '', actionable: false }
  if (outcome.state === REVIEW_STATE.pending) {
    if (active) return null
    // 结果刚落地、复核请求还在路上的那一两秒不算“没开始”：给一个宽限窗，别制造假停。
    const latestResult = [...messages].reverse().find(message => (
      message.kind === 'evidence' && (message.meta?.stage ?? 0) === index
    ))
    if (Number.isFinite(latestResult?.ts) && Date.now() - latestResult.ts < 10_000) return null
    // 没有任何复核交接在外面：这不是“验收员在看”，是“复核没开始”。
    // 说成前者会让人一直等一个不会发生的结论（真房：第 3 步这样停了半小时）。
    const reviewing = (room.assignments ?? []).some(item => (
      item.stageIndex === index &&
      item.reason === 'review' &&
      ['created', 'sent', 'working'].includes(item.status)
    ))
    return reviewing
      ? { kind: 'review', stage: index, label: '验收员在看', detail: '验收员还在核对结果。', actionable: false }
      : { kind: 'review-timeout', stage: index, label: '复核没有开始', detail: '可以再叫一次复核，或退回重做。' }
  }
  return null
}
