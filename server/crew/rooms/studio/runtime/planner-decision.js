import { createHash } from 'node:crypto'
import { memberDisplayName } from '../../../member-labels.js'
import { INTERNAL_PROMPT_MARKER } from '../../../internal-prompts.js'
import { judgmentAnchorOf, judgmentOf, normalizeJudgment } from '../../../../../shared/judgment.js'
import { gateSubmissionOf } from '../../../../../shared/gate.js'
import {
  activeDispatchAssignments as activeDispatch,
  latestDispatchAssignment,
  transitionAssignment,
} from '../../../assignments.js'
import { leadMemberOf, workerIds } from '../../../room-members.js'
import { systemNotice } from '../../../notices.js'
import { MAX_STAGE_REWORKS } from '../relay.js'
import { PLANNER_DECISION_KIND } from '../../../../../shared/states.js'

export const createPlannerRouting = ({ store, roomId, sendToMember, handoff, plannerNudges, schedule, expireCards = null }) => {
  // 退回后规划师的第一行是决定；转交由系统投递，模型写不写 @ 都不影响下一棒。
  const routePlannerDecision = (room, stageIndex, turn, calls = []) => {
    const messages = store.readMessages(roomId)
    const latestVerdict = [...messages].reverse()
      .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === stageIndex)
    if (latestVerdict === undefined || judgmentOf(latestVerdict)?.decision !== 'reject') return false
    const verdictIndex = messages.indexOf(latestVerdict)
    if (messages.slice(verdictIndex + 1).some(message => (
      message.kind === 'evidence' && (message.meta?.stage ?? 0) === stageIndex
    ))) return false
    const verdictId = latestVerdict.id ?? latestVerdict.seq
    if (room.lastPlannerDecision?.verdictId === verdictId) return false

    const lead = leadMemberOf(room)?.id
    const gateJudgment = gateSubmissionOf(calls, {
      type: 'planner',
      stage: stageIndex,
      actorId: lead,
    })
    const anchor = gateJudgment === null ? judgmentAnchorOf('planner', turn.reply) : null
    const nudgeKey = `${stageIndex}:${verdictId}`
    const settleMissing = () => {
      const current = store.readRoom(roomId)
      if (current === null || current.lastPlannerDecision?.verdictId === verdictId) return
      const missing = {
        version: 1,
        type: 'planner',
        decision: 'human',
        reason: '规划师没有提交决定，房间先把这一步交给你。',
        findings: [],
        actionRequired: '规划师没有提交决定；请决定这一步是重做，还是由你接手。',
        stage: stageIndex,
        evidenceId: null,
        actorId: lead ?? null,
        rejectTo: 'human',
        at: Date.now(),
        source: 'missing',
      }
      store.updateRound(roomId, roomState => {
        roomState.lastPlannerDecision = {
          stage: stageIndex,
          verdictId,
          kind: PLANNER_DECISION_KIND.human,
          judgment: missing,
          at: Date.now(),
        }
        return { events: [] }
      })
      for (const item of activeDispatch(store, roomId, stageIndex)) {
        transitionAssignment(store, item.id, 'rejected', { resultText: '规划师没有提交决定，已交给人' })
      }
      store.appendEvent(roomId, 'handoff.human', {
        stage: stageIndex,
        from: lead ?? null,
        reason: 'planner-missing',
        actionRequired: missing.actionRequired,
      })
      store.appendMessage(roomId, { kind: 'system', text: '规划师没有提交决定，已把这一步交给你处理。' })
    }
    // 没有工具提交、首行也不是「返工/交给人」：先催它只提交决定，再收口给人，不猜。
    if (gateJudgment === null && anchor === null) {
      if (plannerNudges.has(nudgeKey)) {
        settleMissing()
        return true
      }
      plannerNudges.add(nudgeKey)
      if (typeof lead !== 'string' || lead === '' || typeof sendToMember !== 'function') {
        settleMissing()
        return true
      }
      void sendToMember(lead, [
        '你这一回合没有提交决定。现在只做一件事：调用 lodge_gate_submit_decision 提交「返工」或「交给人」；',
        '工具确实不可用时只回复一行「返工」或「交给人」。不要继续调研，也不要改文件。',
        INTERNAL_PROMPT_MARKER,
      ].join('\n'), {
        intent: 'decision',
        from: '验收流程',
        sendId: `n-${createHash('sha1').update(nudgeKey).digest('hex').slice(0, 32)}`,
      }).catch(error => {
        systemNotice({ store, roomId, text: '没能再叫规划师提交决定；稍后会把这一步交给你。', error })
      })
      schedule(settleMissing, 120_000)
      return true
    }
    const submitted = gateJudgment ?? normalizeJudgment({
      type: 'planner',
      text: turn.reply,
      stage: stageIndex,
      actorId: lead,
    })
    // 返工预算按这一步实际发生过的重做次数算；用完就交给人，不再无限重跑。
    const reworksUsed = messages.filter(message => (
      message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex
    )).length
    const judgment = submitted.rejectTo === 'worker' && reworksUsed >= MAX_STAGE_REWORKS
      ? {
        version: 1,
        type: 'planner',
        decision: 'human',
        reason: `这一步已经重做 ${reworksUsed} 次，重做次数用完了。`,
        findings: [],
        actionRequired: '重做次数已经用完；请决定继续重做、改目标，还是由你接手。',
        stage: stageIndex,
        evidenceId: null,
        actorId: lead ?? null,
        rejectTo: 'human',
        at: Date.now(),
        source: 'policy',
      }
      : submitted
    store.updateRound(roomId, current => {
      current.lastPlannerDecision = { stage: stageIndex, verdictId, kind: judgment.decision, judgment, at: Date.now() }
      return { events: [] }
    })
    // 合并冲突要人拍板；规划师自动返工会把冲突清掉，等于替人做了决定。
    if (room.mergeConflict?.stage === stageIndex) return true
    const stage = room.stages?.[stageIndex]
    if (judgment.rejectTo !== 'worker') {
      // 交给人是这一步的当前收口：执行交接不再挂着，等人的决定。
      for (const item of activeDispatch(store, roomId, stageIndex)) {
        transitionAssignment(store, item.id, 'rejected', {
          resultText: judgment.reason === '' ? '规划师把这一步交给人' : `交给人：${judgment.reason}`,
        })
      }
      store.appendEvent(roomId, 'handoff.human', {
        stage: stageIndex,
        from: leadMemberOf(room)?.id ?? null,
        reason: judgment.reason,
        actionRequired: judgment.actionRequired,
      })
      return true
    }
    // 并行阶段的重做要送进每一位执行成员的工作副本；只叫一个人会把另一条分支留在旧结果上。
    const assignees = (Array.isArray(stage?.assignees) ? stage.assignees : [])
      .filter(id => workerIds(room).includes(id))
    const targets = assignees.length > 0 ? assignees : workerIds(room)
    if (targets.length === 0) {
      store.appendEvent(roomId, 'handoff.human', {
        stage: stageIndex,
        from: leadMemberOf(room)?.id ?? null,
        reason: 'no-executor',
        actionRequired: '这一步没有执行成员；请补人或由你接手。',
      })
      store.appendMessage(roomId, { kind: 'system', text: '这一步没有执行成员，规划师没法把重做交出去。' })
      return true
    }
    const parents = new Map()
    for (const target of targets) {
      const parent = latestDispatchAssignment(store, roomId, stageIndex, target)
      parents.set(target, parent)
      if (parent !== null) transitionAssignment(store, parent.id, 'failed', { resultText: '验收退回，规划师安排重做' })
    }
    const parallel = targets.length > 1
    const note = judgment.reason
    store.appendMessage(roomId, {
      kind: 'rework',
      authorId: 'system',
      text: '验收退回，规划师安排重做。',
      meta: { stage: stageIndex, source: 'planner', note, verdictId, judgment },
    })
    if (typeof expireCards === 'function') expireCards()
    if (parallel) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `@${targets.map(target => memberDisplayName(room, target)).join('、@')} 验收退回，按上面的意见重做第 ${stageIndex + 1} 步。`,
        meta: { kind: 'handoff', stage: stageIndex, to: targets },
      })
    }
    for (const target of targets) {
      const name = memberDisplayName(room, target)
      void handoff.trigger({
        room,
        stage,
        index: stageIndex,
        from: leadMemberOf(room)?.id,
        to: target,
        reason: 'rework',
        prompt: `${note}\n${INTERNAL_PROMPT_MARKER}`,
        // @ 由系统写，退回理由已经在验收卡里。
        message: parallel ? '' : `@${name} 验收退回，按上面的意见重做。`,
        visible: !parallel,
        deliver: true,
        ...(parallel ? { privateRoom: true } : {}),
        acceptance: stage?.acceptance ?? '',
        rework: true,
        parentAssignmentId: parents.get(target)?.id ?? null,
      }).catch(error => {
        systemNotice({ store, roomId, text: `重做没能交给${name}；待处理。`, error })
      })
    }
    return true
  }

  return routePlannerDecision
}
