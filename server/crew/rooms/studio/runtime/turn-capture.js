import { createHash } from 'node:crypto'
import { addTurnUsage } from '../../../../../shared/usage.js'
import { memberDisplayName } from '../../../member-labels.js'
import { createTurnDiagnostics } from './diagnostics.js'
import { verdictPassed } from '../../../../../shared/judgment.js'
import { ASSIGNMENT_TERMINAL, OPEN_ROUND_STATUSES, STAGE_STATE } from '../../../../../shared/states.js'
import { askDecisionOf, askQuestionOf, resumeRequestOf, rewindRequestOf, stopRequestOf, submitPlanOf, modelAdjustmentOf } from '../../../../../shared/gate.js'
import {
  activeDispatchAssignments as activeDispatch,
  assignmentForTurn,
  transitionAssignment,
  updateAssignment,
} from '../../../assignments.js'
import { dispatchOf } from '../../../assignment-projections.js'
import { leadMemberOf, memberOf } from '../../../room-members.js'
import { deliverableStageIndex, isWorkStage, memberForRef } from '../turn-utils.js'
import { vcsOf, workspaceOf } from '../workspace.js'
import { systemNotice } from '../../../notices.js'
import { hasLaterWorkStage } from '../review-policy.js'
import { cancelAssignmentLease } from '../assignment-lease.js'
import { redactSecrets } from '../../../../../shared/secrets.js'
import { guardTurn } from '../../../workspace-guard.js'

export const createTurnCapture = ({
  store,
  roomId,
  emit,
  files,
  state,
  integrator,
  review,
  acceptance,
  routePlannerDecision,
  autoCheck,
  markManualReady,
  confirmStage = null,
  rewindStage = null,
  stopRound = null,
  resumeRound = null,
  applyPlan = null,
  adjustModel = null,
  writeDiagnostic = null,
  setMembers = null,
}) => {
  const captureTurn = (turn, authorRef) => {
    const turnId = turn?.turnId
    if (typeof turnId !== 'string' || state.capturedTurns.has(turnId)) return
    if (turn?.usage !== undefined && turn?.usage !== null) {
      store.updateRound(roomId, current => {
        const usage = addTurnUsage(current.usage, turn.usage)
        if (usage === null) return null
        current.usage = usage
        return { events: [] }
      })
    }
    const room = store.readRoom(roomId)
    const memberId = memberForRef(room, authorRef)
    // 成员的 shell 不做 OS 沙箱（基座只给验收命令）；这里在回合后对账，越界写到别人工作树的改动退回。
    if (memberId !== null) {
      for (const violation of guardTurn(room, memberId)) {
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${memberDisplayName(room, memberId)} 改到了 ${memberDisplayName(room, violation.memberId)} 的工作副本；${violation.reverted ? '越界改动已经退回' : '没有自动退回，请人看一下'}。`,
        })
      }
    }
    const role = memberOf(room, memberId)?.role
    const calls = state.turns.get(turnId) ?? []
    const leadTurn = role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id
    // 控制动作先于一切：停下、接回、退回的回合不再走自动确认和派活。
    if (leadTurn) {
      // 用户的意思是接着做：把停下的一轮接回来；之后的继续由服务层再叫醒一次。
      const resume = resumeRequestOf(calls)
      if (resume !== null && typeof resumeRound === 'function') {
        const result = resumeRound(roomId, resume)
        if (result?.ok === true) {
          store.appendEvent(roomId, 'planner.resume', { roundId: result.body?.round?.id ?? null })
          emit?.('room', store.readRoom(roomId) ?? room)
          state.recordTurn(true)
          return
        }
        systemNotice({ store, roomId, text: `继续没成功：${result?.error ?? '再试一次'}` })
      }
      // 用户说停时，用它把这一轮真的停住；只是说一句「停」不会在这里生效。
      const stop = stopRequestOf(calls)
      if (stop !== null && typeof stopRound === 'function') {
        void Promise.resolve(stopRound(roomId, stop))
          .then(result => {
            if (result?.ok === true) {
              store.appendEvent(roomId, 'planner.stop', { reason: stop.reason })
              emit?.('room', store.readRoom(roomId) ?? room)
              return
            }
            systemNotice({ store, roomId, text: `停止没成功：${result?.error ?? '再试一次'}` })
          })
          .catch(() => systemNotice({ store, roomId, text: '停止没成功，再试一次。' }))
        state.recordTurn(true)
        return
      }
      const request = rewindRequestOf(calls)
      if (request !== null && typeof rewindStage === 'function') {
        const result = rewindStage(roomId, request)
        if (result?.ok === true) {
          store.appendEvent(roomId, 'planner.rewind', { stage: request.stage, note: request.note })
          emit?.('room', store.readRoom(roomId) ?? room)
          state.recordTurn(true)
          return
        }
        systemNotice({ store, roomId, text: `退回没成功：${result?.error ?? '再试一次'}` })
      }
    }
    // 轮次已经不在跑（停下或终态）：迟到的成员回合只记下来，不写证据、不推进。
    if (!OPEN_ROUND_STATUSES.has(room?.workRound?.status ?? 'active')) {
      state.capturedTurns.add(turnId)
      state.turns.delete(turnId)
      state.recordTurn(false)
      return
    }
    // 规划师交了方案和队伍：平台校验并开通成员，然后由它接上第一步。
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const proposal = submitPlanOf(calls)
      if (proposal !== null && typeof applyPlan === 'function') {
        state.capturedTurns.add(turnId)
        state.recordTurn(true)
        void Promise.resolve(applyPlan(roomId, proposal)).catch(error => {
          systemNotice({ store, roomId, text: '组队没能开始；待处理。', error })
        })
        return
      }
    }
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const modelChange = modelAdjustmentOf(calls)
      if (modelChange !== null && typeof adjustModel === 'function') {
        state.capturedTurns.add(turnId)
        state.recordTurn(true)
        void Promise.resolve(adjustModel(roomId, modelChange)).catch(error => {
          systemNotice({ store, roomId, text: '换模型没成功；待处理。', error })
        })
        return
      }
    }
    // 规划师遇到真正的分叉：存一张决策卡，暂停派活，等用户选。
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const activeIndex = (room.stages ?? []).findIndex(stage => stage.state === STAGE_STATE.active)
      const ask = askDecisionOf(calls, {
        id: `decision-${turnId}`,
        roomId,
        roundId: room.activeRoundId ?? null,
        stage: activeIndex >= 0 ? activeIndex : null,
        at: Number.isFinite(turn?.at) ? turn.at : Date.now(),
      })
      if (ask !== null) {
        state.capturedTurns.add(turnId)
        if (room.pendingDecision?.status !== 'open') {
          // 等用户拍板时基座群聊里只留规划师；被移出的人连 @ 都收不到。
          // 对齐开局已经只留规划师，不再重复改名单，免得撞上基座正在跑回合。
          const first = room.stages?.[0]
          const alreadyAlone = first?.title === '目标对齐' && first.state !== STAGE_STATE.passed
          if (!alreadyAlone && typeof setMembers === 'function') void setMembers(roomId, [memberId])
          const updated = store.updateRound(roomId, current => {
            current.pendingDecision = ask
            return { events: [{ type: 'decision.asked', payload: { id: ask.id, stage: ask.stage, question: ask.question } }] }
          })
          if (updated !== null) emit?.('room', updated)
        }
        return
      }
      // 只是缺事实：记一个问题，暂停派活，等用户在下面回答。
      const question = askQuestionOf(calls, { at: Number.isFinite(turn?.at) ? turn.at : Date.now() })
      if (question !== null) {
        state.capturedTurns.add(turnId)
        const open = typeof room.openQuestion === 'string' && room.openQuestion.trim() !== ''
        if (!open && room.pendingDecision?.status !== 'open') {
          const updated = store.updateRound(roomId, current => {
            current.openQuestion = question.text
            return { events: [{ type: 'question.asked', payload: { text: question.text } }] }
          })
          if (updated !== null) emit?.('room', updated)
        }
        return
      }
    }
    // 规划师把目标对齐说清楚、又没有留下问题时，对齐这一步自动通过；
    // 这一步没有界面动作，等人只会让零准备开工停在第一屏。
    const alignIndex = room === null ? -1 : room.stages.findIndex(stage => stage.state === STAGE_STATE.active)
    const alignStage = alignIndex >= 0 ? room.stages[alignIndex] : null
    if (
      alignStage?.kind === 'decision' &&
      alignStage?.spine === true &&
      alignStage?.title === '目标对齐' &&
      memberId !== null &&
      memberId === leadMemberOf(room)?.id &&
      // 停下的一轮不再自动确认阶段；只有开着的轮次才往前走。
      OPEN_ROUND_STATUSES.has(room?.workRound?.status ?? 'active') &&
      String(turn?.reply ?? '').trim() !== '' &&
      (room.openQuestion === null || room.openQuestion === undefined || room.openQuestion === '') &&
      // 启动态还没有执行官：对齐由 submit_plan 推进，不在这里自动过。
      (room.members ?? []).some(member => member.roleKind === 'executor' || member.role === 'worker') &&
      typeof confirmStage === 'function'
    ) {
      void Promise.resolve(confirmStage(roomId, alignIndex)).catch(() => {})
    }
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room === null ? null : dispatchOf(store, roomId, stageIndex)
    // 验收已通过、规划师也收过尾：系统收口，不再等人点一次确认。
    const signoffVerdict = [...store.readMessages(roomId)].reverse()
      .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === stageIndex)
    if (
      memberId !== null &&
      memberId === leadMemberOf(room)?.id &&
      room?.stages?.[stageIndex]?.state === STAGE_STATE.active &&
      signoffVerdict !== undefined &&
      verdictPassed(signoffVerdict) &&
      !hasLaterWorkStage(room, stageIndex) &&
      typeof confirmStage === 'function'
    ) {
      void Promise.resolve(confirmStage(roomId, stageIndex, { by: 'system' })).catch(() => {})
    }
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

    if (review.consume({ turn, memberId, turnId, room, calls })) {
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

    const stage = stageIndex

    // 同一个回合可能同时从群聊和成员自己的线程各重放一次，turnId 不同但内容相同；
    // 同一步同一位成员在两分钟内说过完全相同的话，只留第一条证据。
    const replyText = String(turn.reply ?? '').trim()
    const duplicated = replyText !== '' && memberId !== null && store.readMessages(roomId).some(message => (
      message.kind === 'evidence' &&
      message.authorId === memberId &&
      (message.meta?.stage ?? 0) === stage &&
      String(message.text ?? '').trim() === replyText &&
      typeof message.ts === 'number' &&
      Math.abs(Date.now() - message.ts) <= 120_000
    ))
    if (duplicated) {
      state.capturedTurns.add(turnId)
      writeTurn('duplicate')
      return
    }

    // 成员交回第一个新的证据回合就算有进展：停掉成员自己的计时，后面的长回合交给阶段截止兜底。
    if (assignment !== null && ['sent', 'working'].includes(assignment.status)) {
      cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
    }

    const artifacts = []
    for (const call of calls) {
      let input
      try {
        input = JSON.parse(call.input ?? '{}')
      } catch {
        continue
      }
      const filePath = input.file_path
      if (typeof filePath !== 'string' || !files.exists(filePath)) continue
      if (artifacts.some(item => item.path === filePath)) continue
      const content = files.read(filePath)
      artifacts.push({
        path: filePath,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        content: content.length > 16_384
          ? `${content.subarray(0, 16_384).toString('utf8')}\n…`
          : content.toString('utf8'),
      })
    }

    const worked = (turn.toolCalls ?? 0) > 0 || artifacts.length > 0
    const toolSummary = (turn.tools ?? []).map(tool => `${tool.name} ×${tool.count}${tool.failed ? ` (${tool.failed} 失败)` : ''}`)
    const summary = [
      toolSummary.length > 0 ? `工具：${toolSummary.join(' · ')}` : '工具：无',
      `回合：${((turn.durationMs ?? 0) / 1000).toFixed(1)}s`,
    ].join(' · ')
    const evidence = {
      kind: 'evidence',
      authorId: memberId ?? 'worker',
      ts: Date.now(),
      text: redactSecrets(turn.reply || summary),
      meta: {
        kind: 'turn',
        vcs: vcsOf(room),
        stage,
        turnId,
        summary,
        durationMs: turn.durationMs,
        files: artifacts.map(item => item.path.split('/').at(-1)),
        artifacts,
        output: redactSecrets(JSON.stringify({
          tools: turn.tools ?? [],
          toolCalls: turn.toolCalls,
          hookCoverage: turn.hookCoverage,
        }, null, 2)),
        capturedAt: new Date().toISOString(),
      },
    }

    if (parallel) {
      void integrator.enqueue(async () => {
        const current = store.readRoom(roomId)
        if (current === null) return
        const worktree = current.worktrees?.[memberId]
        let candidate = null
        if (worktree !== undefined && workspaceOf(current).capabilities().candidate === true) {
          try {
            candidate = workspaceOf(current).submit({ path: worktree, turnId, name: current.name })
            if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage, turnId, memberId, commit: candidate })
          } catch (error) {
            systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
          }
        }
        const base = dispatch?.stage === stage && typeof dispatch.base === 'string'
          ? dispatch.base
          : workspaceOf(current).head({ path: current.repoPath })
        const range = worktree === undefined
          ? { diff: '', files: [] }
          : await workspaceOf(current).rangeChanges({ path: worktree, base })
        const head = worktree === undefined ? '' : workspaceOf(current).head({ path: worktree })
        const stored = store.appendMessage(roomId, {
          ...evidence,
          meta: {
            ...evidence.meta,
            repoPath: worktree ?? '',
            branch: current.branches?.[memberId] ?? '',
            head,
            diff: redactSecrets(range.diff),
            manifest: range.manifest ?? [],
            changedFiles: range.files,
            candidate,
          },
        })
        if (assignment !== null) {
          transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [stored.id], ...(candidate === null ? {} : { candidate }) })
          cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
        }
        writeTurn('evidence', {
          evidenceIds: [stored.id],
          assignmentId: assignment?.id ?? null,
          candidate,
        })
        store.appendEvent(roomId, 'turn.evidence', { stage, turnId, memberId })
        state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

        const done = integrator.settle(memberId, turnId, false)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            systemNotice({ store, roomId, text: '这一步没有可合并的结果；待处理。' })
          } else {
            await integrator.integrate({ ...done, workers: remaining, turnId })
          }
          return
        }
        if (pendingForMember) return
        if (dispatch !== null && dispatch !== undefined && dispatch.stage !== stage) return
        const active = current.stages[stage]
        if (active === undefined || !isWorkStage(active) || active.state !== STAGE_STATE.active) return
        if (review.isBusy()) return
        const latest = [...store.readMessages(roomId)].reverse()
          .find(message => message.kind === 'verdict' && message.meta?.stage === stage)
        if (latest !== undefined && verdictPassed(latest)) return
        await integrator.integrate({ stageIndex: stage, workers: [memberId], base: workspaceOf(current).head({ path: current.repoPath }), turnId })
      })
      return
    }

    const storedEvidence = store.appendMessage(roomId, evidence)
    if (assignment !== null) {
      transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [storedEvidence.id] })
      cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
      writeTurn('evidence', {
        evidenceIds: [storedEvidence.id],
        assignmentId: assignment.id,
      })
    }
    store.appendEvent(roomId, 'turn.evidence', { stage, turnId })
    state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

    if (room !== null) {
      const target = room.stages[stage]
      const command = typeof target?.acceptance === 'string' ? target.acceptance.trim() : ''
      const key = `${stage}:${turnId}`
      if (target?.manual === true && target.state === STAGE_STATE.active && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        markManualReady(room, stage, turnId, worked)
        if (worked === true) autoCheck(room, stage, turnId)
      } else if (command !== '' && target?.kind === 'deliverable' && target.state === STAGE_STATE.active && worked && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        void acceptance.run(stage, command, turnId)
      }
    }
  }

  return captureTurn
}
