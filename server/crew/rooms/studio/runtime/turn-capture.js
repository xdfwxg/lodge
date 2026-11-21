import { createHash } from 'node:crypto'
import { addTurnUsage } from '../../../../../shared/usage.js'
import { assessTurn } from '../../../turn-assessment.js'
import { memberDisplayName } from '../../../member-labels.js'
import { verdictPassed } from '../../../../../shared/judgment.js'
import { rewindRequestOf } from '../../../../../shared/gate.js'
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
import { armAssignmentLease, cancelAssignmentLease } from '../assignment-lease.js'

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
  writeDiagnostic = null,
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
    const role = memberOf(room, memberId)?.role
    // 规划师把目标对齐说清楚、又没有留下问题时，对齐这一步自动通过；
    // 这一步没有界面动作，等人只会让零准备开工停在第一屏。
    const alignIndex = room === null ? -1 : room.stages.findIndex(stage => stage.state === 'active')
    const alignStage = alignIndex >= 0 ? room.stages[alignIndex] : null
    if (
      alignStage?.kind === 'decision' &&
      alignStage?.spine === true &&
      alignStage?.title === '目标对齐' &&
      memberId !== null &&
      memberId === leadMemberOf(room)?.id &&
      String(turn?.reply ?? '').trim() !== '' &&
      (room.openQuestion === null || room.openQuestion === undefined || room.openQuestion === '') &&
      typeof confirmStage === 'function'
    ) {
      void Promise.resolve(confirmStage(roomId, alignIndex)).catch(() => {})
    }
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room === null ? null : dispatchOf(store, roomId, stageIndex)
    const assignment = memberId === null || room === null
      ? null
      : assignmentForTurn(store, roomId, stageIndex, memberId, turnId)
    // 每个完成的回合都算一次进展：续租，不让一个还在做活的成员被误停。
    if (assignment !== null && ['sent', 'working'].includes(assignment.status)) {
      armAssignmentLease({
        store,
        roomId,
        assignmentId: assignment.id,
        stage: assignment.stageIndex,
        memberId: assignment.toMemberId,
        roundId: room?.workRound?.id ?? null,
      })
    }
    const parallel = (dispatch?.workers?.length ?? 0) > 1
    const writeTurnDiagnostic = (outcome, extra = {}) => {
      if (typeof writeDiagnostic !== 'function' || room === null) return
      try {
        const diagnostic = {
          version: 2,
          roomId,
          roomName: room.name,
          stage: stageIndex,
          stageTitle: room.stages?.[stageIndex]?.title ?? '',
          memberId,
          role,
          turnId,
          at: turn?.at ?? null,
          durationMs: turn?.durationMs ?? null,
          toolCalls: turn?.toolCalls ?? 0,
          tools: Array.isArray(turn?.tools) ? turn.tools : [],
          usage: turn?.usage ?? null,
          hookCoverage: turn?.hookCoverage ?? null,
          outcome,
          assessment: assessTurn({ outcome, turn, extra }),
          ...extra,
        }
        void Promise.resolve(writeDiagnostic(room, turnId, diagnostic)).catch(() => {})
        store.updateRound(roomId, current => {
          current.stageDiagnostics = {
            ...(current.stageDiagnostics ?? {}),
            [stageIndex]: {
              at: diagnostic.at ?? Date.now(),
              memberId,
              outcome,
              turnId,
              assessment: diagnostic.assessment,
            },
          }
          return { events: [] }
        })
      } catch {}
    }
    writeTurnDiagnostic('captured')
    const pendingForMember = role === 'worker' &&
      assignment !== null &&
      ['created', 'sent', 'working'].includes(assignment.status) &&
      assignment.context?.parallel === true
    // 旧尝试的回合可能在新一次派发之后才回来；开始时间早于当前交接就丢弃，别污染新结果。
    const startedAt = Number.isFinite(turn?.at) && Number.isFinite(turn?.durationMs)
      ? turn.at - turn.durationMs
      : null
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
      writeTurnDiagnostic('stale', { startedAt, activatedAt: stageActivatedAt, reason: 'stage-started' })
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
      writeTurnDiagnostic('stale', { startedAt, sentAt: assignment.sentAt })
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
      writeTurnDiagnostic('empty')
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
    const calls = state.turns.get(turnId) ?? []
    state.turns.delete(turnId)

    if (role === 'lead') {
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

    if (review.consume({ turn, memberId, turnId, room, calls })) {
      writeTurnDiagnostic('review')
      state.recordTurn(true)
      return
    }

    store.appendEvent(roomId, 'turn.completed', { turnId, memberId: memberId ?? 'unknown' })
    if (role === 'lead' && routePlannerDecision(room, stageIndex, turn, calls)) {
      writeTurnDiagnostic('decision')
      // 规划师交给人或安排返工，本身就是进展；不能算作空转。
      state.recordTurn(true)
      return
    }
    if (role !== 'worker') {
      writeTurnDiagnostic('ignored')
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
      writeTurnDiagnostic('duplicate')
      return
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
      text: turn.reply || summary,
      meta: {
        kind: 'turn',
        vcs: vcsOf(room),
        stage,
        turnId,
        summary,
        durationMs: turn.durationMs,
        files: artifacts.map(item => item.path.split('/').at(-1)),
        artifacts,
        output: JSON.stringify({
          tools: turn.tools ?? [],
          toolCalls: turn.toolCalls,
          hookCoverage: turn.hookCoverage,
        }, null, 2),
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
            diff: range.diff,
            manifest: range.manifest ?? [],
            changedFiles: range.files,
            candidate,
          },
        })
        if (assignment !== null) {
          transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [stored.id], ...(candidate === null ? {} : { candidate }) })
          cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
        }
        writeTurnDiagnostic('evidence', {
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
        if (active === undefined || !isWorkStage(active) || active.state !== 'active') return
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
      writeTurnDiagnostic('evidence', {
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
      if (target?.manual === true && target.state === 'active' && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        markManualReady(room, stage, turnId, worked)
        if (worked === true) autoCheck(room, stage, turnId)
      } else if (command !== '' && target?.kind === 'deliverable' && target.state === 'active' && worked && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        void acceptance.run(stage, command, turnId)
      }
    }
  }

  return captureTurn
}
