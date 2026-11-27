import { createHash } from 'node:crypto'
import { addTurnUsage } from '../../../../../shared/usage.js'
import { memberDisplayName } from '../../../member-labels.js'
import { createTurnDiagnostics } from './diagnostics.js'
import { verdictPassed } from '../../../../../shared/judgment.js'
import { reworkFloor } from '../../../../../shared/attempt.js'
import { ASSIGNMENT_TERMINAL, OPEN_ROUND_STATUSES, STAGE_STATE } from '../../../../../shared/states.js'
import { askDecisionOf, askQuestionOf, resumeRequestOf, rewindRequestOf, stopRequestOf, submitPlanOf, modelAdjustmentOf } from '../../../../../shared/gate.js'
import {
  activeDispatchAssignments as activeDispatch,
  assignmentForTurn,
  transitionAssignment,
  updateAssignment,
} from '../../../assignments.js'
import { dispatchOf } from '../../../assignment-projections.js'
import { captureWorkerResult } from './worker-result.js'
import { leadMemberOf, memberOf } from '../../../room-members.js'
import { deliverableStageIndex, isWorkStage, memberForRef } from './turn-utils.js'
import { vcsOf, workspaceOf } from './workspace.js'
import { systemNotice } from '../../../notices.js'
import { handlePlannerTurn } from './planner-turn.js'
import { INTERNAL_PROMPT_MARKER } from '../../../internal-prompts.js'
import { hasLaterWorkStage } from '../acceptance/review-policy.js'
import { cancelAssignmentLease } from '../plan/assignment-lease.js'
import { redactSecrets } from '../../../../../shared/secrets.js'
import { guardTurn, unreturnedReadOnlyViolations } from '../../../workspace-guard.js'
import { foreignReadsOf } from '../acceptance/read-boundary.js'
import { parkPackageProof } from '../delivery/proof-assembly.js'
import { enforceWriteBoundary } from './result.js'
import { ownsProofFileFor } from '../delivery/write-boundary.js'
import { packageProofFile } from '../../../../../shared/proof.js'

export const createTurnCapture = ({
  store,
  roomId,
  emit,
  files,
  state,
  integrator,
  review,
  routePlannerDecision,
  markResultReady,
  confirmStage = null,
  rewindStage = null,
  adviseStop = null,
  resumeRound = null,
  applyPlan = null,
  adjustModel = null,
  writeDiagnostic = null,
  setMembers = null,
  sendToMember = null,
  planNudges = null,
}) => {
  const captureTurn = async (turn, authorRef) => {
    const turnId = turn?.turnId
    if (typeof turnId !== 'string' || state.capturedTurns.has(turnId)) return
    const room = store.readRoom(roomId)
    const roundOpen = OPEN_ROUND_STATUSES.has(room?.workRound?.status ?? 'active')
    // 已结束的轮次不能再记用量；否则晚到的回合会先撞上“终态轮不能写”，连忽略都做不到。
    if (roundOpen && turn?.usage !== undefined && turn?.usage !== null) {
      store.updateRound(roomId, current => {
        const usage = addTurnUsage(current.usage, turn.usage)
        if (usage === null) return null
        current.usage = usage
        return { events: [] }
      })
    }
    const memberId = memberForRef(room, authorRef)
    // 成员的 shell 不做 OS 沙箱；这里在回合后对账，越界写到别人工作树的改动退回。
    if (memberId !== null) {
      // 并行派发时别人的副本本来就在变：跨人对账会把队友的工作算成越界，只看说话人自己的树。
      const guardStage = room === null ? -1 : deliverableStageIndex(room)
      const guardingParallel = guardStage >= 0 && (dispatchOf(store, roomId, guardStage)?.workers?.length ?? 0) > 1
      const violations = guardTurn(room, memberId, { others: !guardingParallel })
      for (const violation of violations) {
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${memberDisplayName(room, memberId)} 改到了 ${memberDisplayName(room, violation.memberId)} 的工作副本；${violation.reverted ? '越界改动已经退回' : '没有自动退回，请人看一下'}。`,
        })
      }
      // 只读角色改了别人正在用的工作树、又退不回去：继续做只会把两份改动搅在一起。
      const stuck = unreturnedReadOnlyViolations({ room, memberId, violations })
      if (stuck.length > 0) {
        const active = (room.stages ?? []).findIndex(stage => stage.state === STAGE_STATE.active)
        const stageIndex = active < 0 ? 0 : active
        store.appendMessage(roomId, {
          kind: 'system',
          text: '这一轮先停下：越界改动没能退回，等人处理。',
        })
        const updated = store.updateRound(roomId, current => {
          current.blocked = {
            stage: stageIndex,
            reason: 'boundary',
            source: 'guard',
            members: stuck.map(item => item.memberId),
            at: Date.now(),
          }
          return { events: [{ type: 'stage.blocked', payload: { stage: stageIndex, reason: 'boundary', source: 'guard' } }] }
        })
        if (updated !== null) emit?.('room', updated)
      }
      // 读别人的工作副本也当场拦：不等验收判定，留下证据并停住这一轮。
      const calls = state.turns.get(turnId) ?? []
      const foreign = foreignReadsOf({ calls, room, memberId, membersOnly: true })
      if (foreign.length > 0) {
        const active = (room.stages ?? []).findIndex(stage => stage.state === STAGE_STATE.active)
        const stageIndex = active < 0 ? 0 : active
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${memberDisplayName(room, memberId)} 读了别人的工作副本：${foreign.slice(0, 3).map(item => `${item.path}（${item.root}）`).join('、')}；这一回合不算数，继续用其余人的结果。`,
        })
        const updated = store.updateRound(roomId, current => {
          if (current.blocked?.reason === 'read-boundary') return null
          current.blocked = {
            stage: stageIndex,
            reason: 'read-boundary',
            source: 'read-guard',
            members: [memberId],
            at: Date.now(),
          }
          return { events: [{ type: 'stage.blocked', payload: { stage: stageIndex, reason: 'read-boundary', source: 'read-guard' } }] }
        })
        if (updated !== null) emit?.('room', updated)
      }
    }
    const role = memberOf(room, memberId)?.role
    const calls = state.turns.get(turnId) ?? []
    const leadTurn = role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id
    // 规划师这一侧的房间动作都在 planner-turn.js：处理掉就结束这个回合。
    if (role === 'lead' || leadTurn) {
      const handled = await handlePlannerTurn({
        store, roomId, emit, state, room, memberId, turn, turnId, calls, role, leadTurn,
        leadId: leadMemberOf(room)?.id ?? null,
        sendToMember, planNudges, resumeRound, adviseStop, rewindStage, applyPlan, adjustModel,
        setMembers, confirmStage, roundOpen,
      })
      if (handled === true) return
    }
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room === null ? null : dispatchOf(store, roomId, stageIndex)
    // 旧尝试的回合可能在新一次派发之后才回来；开始时间早于当前交接就丢弃，别污染新结果。
    const startedAt = Number.isFinite(turn?.at) && Number.isFinite(turn?.durationMs)
      ? turn.at - turn.durationMs
      : null
    const assignment = memberId === null || room === null
      ? null
      : assignmentForTurn(store, roomId, stageIndex, memberId, turnId, startedAt)
    // 归因失败和迟到回合都只留诊断，不改变实际归属。
    if (role === 'worker' && assignment === null) {
      store.appendEvent(roomId, 'turn.unattributed', {
        turnId,
        memberId,
        stage: stageIndex,
        startedAt,
      })
    }
    if (assignment !== null && ASSIGNMENT_TERMINAL.has(assignment.status)) {
      store.appendEvent(roomId, 'turn.late_terminal', {
        turnId,
        memberId,
        stage: stageIndex,
        assignmentId: assignment.id,
        status: assignment.status,
      })
    }
    const parallel = (dispatch?.workers?.length ?? 0) > 1
    const writeTurnDiagnostic = createTurnDiagnostics({ store, roomId, writeDiagnostic })
    const writeTurn = (outcome, extra = {}) => writeTurnDiagnostic({ room, stageIndex, memberId, role, turn, outcome, extra })
    writeTurn('captured')
    const pendingForMember = role === 'worker' &&
      assignment !== null &&
      ['created', 'sent', 'working'].includes(assignment.status) &&
      assignment.context?.parallel === true
    const stageActivatedAt = Number.isFinite(room?.stages?.[stageIndex]?.activatedAt)
      ? room.stages[stageIndex].activatedAt
      : null
    if (
      role === 'worker' &&
      startedAt !== null &&
      stageActivatedAt !== null &&
      startedAt < stageActivatedAt - 5000
    ) {
      state.capturedTurns.add(turnId)
      writeTurn('stale', { startedAt, activatedAt: stageActivatedAt, reason: 'stage-started' })
      store.appendEvent(roomId, 'turn.stale', {
        turnId,
        memberId,
        stage: stageIndex,
        startedAt,
        activatedAt: stageActivatedAt,
        reason: 'stage-started',
      })
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${memberDisplayName(room, memberId)} 的旧回合结果已忽略；这一步刚开始。`,
      })
      return
    }
    if (
      role === 'worker' &&
      assignment !== null &&
      startedAt !== null &&
      Number.isFinite(assignment.sentAt) &&
      startedAt < assignment.sentAt - 5000
    ) {
      state.capturedTurns.add(turnId)
      writeTurn('stale', { startedAt, sentAt: assignment.sentAt })
      store.appendEvent(roomId, 'turn.stale', {
        turnId,
        memberId,
        stage: stageIndex,
        startedAt,
        sentAt: assignment.sentAt,
      })
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${memberDisplayName(room, memberId)} 的旧回合结果已忽略；这一步已经重开。`,
      })
      return
    }

    // 被停下或失败的回合不是交付结果：文末那句“已停下”不能当成结果送去复核。
    // 终态来自基座的 digest（唯一真相），房间只按它分路。
    const stopReason = typeof turn.stopReason === 'string' ? turn.stopReason : ''
    if (stopReason !== '' && stopReason !== 'completed') {
      state.capturedTurns.add(turnId)
      state.turns.delete(turnId)
      writeTurn('stopped', { stopReason })
      store.appendEvent(roomId, 'turn.stopped', { turnId, memberId, stage: stageIndex, stopReason })
      if (assignment !== null && ['created', 'sent', 'working'].includes(assignment.status)) {
        transitionAssignment(store, assignment.id, 'failed', {
          resultText: stopReason === 'stopped' ? '回合被停下' : '回合没有跑完',
        })
        cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
        const done = integrator.settle(memberId, turnId, true)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            systemNotice({ store, roomId, text: '这一步没有交回结果；待处理。' })
            // 被停下也要给出去处：和“没有产出”一样把这一步标成卡住，
            // 房间才会亮出「退回重做」的卡，而不是留一句待处理让人干等。
            for (const item of activeDispatch(store, roomId, done.stageIndex)) {
              updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), stalled: true } })
            }
            emit?.('room', store.readRoom(roomId))
          } else {
            void integrator.enqueue(() => integrator.integrate({ ...done, workers: remaining, turnId }))
          }
        }
      }
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${memberDisplayName(room, memberId)} 这一回合没有跑完（${stopReason === 'stopped' ? '被停下' : stopReason}）；这一步还没有交回。`,
        // 重启后基座会重放这一回合；带上 turnId，seed 认得它已经处理过。
        meta: { kind: 'turn_stopped', turnId },
      })
      // 验收员没跑完：这一拍复核当场作废，不让房间空等下一次超时。
      review.fail?.({
        memberId,
        reason: `${memberDisplayName(room, memberId)} 这一回合没有跑完（${stopReason === 'stopped' ? '被停下' : stopReason}）；这一轮仍未通过。`,
      })
      emit?.('room', store.readRoom(roomId))
      state.recordTurn(false)
      return
    }
    if ((turn.toolCalls ?? 0) === 0 && (turn.reply ?? '') === '') {
      writeTurn('empty')
      if (pendingForMember) {
        state.capturedTurns.add(turnId)
        if (assignment !== null) {
          transitionAssignment(store, assignment.id, 'failed', { resultText: '没有产出' })
          cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
        }
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${memberDisplayName(room, memberId)} 这一回合没有产出；继续等其它成员。`,
        })
        const done = integrator.settle(memberId, turnId, true)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            systemNotice({ store, roomId, text: '这一步没有产出；待处理。' })
            for (const item of activeDispatch(store, roomId, done.stageIndex)) {
              updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), stalled: true } })
            }
            emit?.('room', store.readRoom(roomId))
          } else {
            void integrator.enqueue(() => integrator.integrate({ ...done, workers: remaining, turnId }))
          }
        }
      }
      return
    }
    state.capturedTurns.add(turnId)
    state.turns.delete(turnId)

    if (await review.consume({ turn, memberId, turnId, room, calls })) {
      writeTurn('review')
      state.recordTurn(true)
      return
    }

    store.appendEvent(roomId, 'turn.completed', { turnId, memberId: memberId ?? 'unknown' })
    if (role === 'lead' && routePlannerDecision(room, stageIndex, turn, calls)) {
      writeTurn('decision')
      // 规划师交给人或安排返工，本身就是进展；不能算作空转。
      state.recordTurn(true)
      return
    }
    if (role !== 'worker') {
      writeTurn('ignored')
      state.recordTurn(false)
      return
    }

    await captureWorkerResult({
      store, roomId, emit, files, state, integrator, review, markResultReady,
      room, memberId, turn, turnId, calls, stageIndex, dispatch, parallel,
      assignment, pendingForMember, writeTurn,
    })
  }

  return captureTurn
}
