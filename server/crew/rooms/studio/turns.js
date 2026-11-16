import { createHash } from 'node:crypto'
import { memberDisplayName } from '../../member-labels.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { reviewState } from './verifiers.js'
import { createAcceptanceRunner } from './acceptance-runner.js'
import { createStageIntegrator } from './integration.js'
import { createReviewCoordinator } from './review.js'
import { createHandoff } from './handoff.js'
import { createStageStarter } from './stage.js'
import { createTurnState } from './turn-state.js'
import { deliverableStageIndex, isWorkStage, parsePlannerDecision, memberForRef } from './turn-utils.js'
import { activeDispatchAssignments as activeDispatch, assignmentForTurn, dispatchOf, updateAssignment } from '../../assignments.js'
import { leadMemberOf, memberOf, verifierIds, workerIds } from '../../room-members.js'
import { vcsOf, workspaceOf } from './workspace.js'

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, roomId, emit, sendToMember, commands, files, advisor = null }) => {
  const state = createTurnState({ store, roomId, emit })
  const handoff = createHandoff({ store, roomId, sendToMember, emit })
  const review = createReviewCoordinator({ store, roomId, emit, sendToMember, handoff, advisor })
  const acceptance = createAcceptanceRunner({
    store,
    roomId,
    markProgress: state.markProgress,
    requestReview: review.request,
    run: commands.run,
  })
  const integrator = createStageIntegrator({
    store,
    roomId,
    emit,
    markProgress: state.markProgress,
    requestReview: review.request,
    run: commands.run,
  })
  const stageStarter = createStageStarter({
    store,
    roomId,
    emit,
    handoff,
    integrate: integrator.integrate,
    enqueue: integrator.enqueue,
  })

  const markManualReady = (room, stageIndex, turnId, worked) => {
    let candidate = null
    try {
      if (workspaceOf(room).capabilities().candidate === true) {
        candidate = workspaceOf(room).submit({ path: room.repoPath, turnId, name: room.name })
        if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
      }
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `没法准备检查副本：${error?.message ?? error}` })
    }
    const head = typeof workspaceOf(room).head === 'function' && typeof room.repoPath === 'string' && room.repoPath !== ''
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    const acceptedRef = candidate ?? head
    const baseline = room.stageBases?.[stageIndex] ?? null
    const files = acceptedRef !== null && baseline !== null && typeof workspaceOf(room).changedFilesSince === 'function'
      ? workspaceOf(room).changedFilesSince({ path: room.repoPath, base: baseline })
      : []
    // 人工阶段没有命令可判“无改动”：同一 HEAD 上的重复回合不重复生成验收证据，也不重复送审。
    const prior = [...store.readMessages(roomId)].reverse().find(message => (
      message.kind === 'evidence' &&
      message.meta?.kind === 'manual' &&
      (message.meta?.stage ?? 0) === stageIndex
    ))
    const covered = prior?.meta?.candidate ?? prior?.meta?.head ?? null
    if (prior !== undefined) {
      if (covered !== null && acceptedRef !== null && covered === acceptedRef) return
      if (!worked && covered === null) return
    }
    const hasVerifier = verifierIds(room).length > 0
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: hasVerifier ? '结果已经好了，等验收员复核。' : '结果已经好了，可以验收了。',
      meta: {
        kind: 'manual',
        stage: stageIndex,
        turnId,
        candidate,
        head: typeof acceptedRef === 'string' && acceptedRef !== '' ? acceptedRef : null,
        files,
        changedFiles: files,
        repoPath: room.repoPath,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    store.appendMessage(roomId, { kind: 'system', text: hasVerifier ? '结果已经好了 · 等验收员复核' : '结果已经好了 · 可以验收了' })
    state.markProgress()
    if (hasVerifier) {
      void review.request(stageIndex).catch(error => {
        store.appendMessage(roomId, { kind: 'system', text: `人工验收复核未启动：${error?.message ?? error}` })
      })
    }
  }

  // 退回后规划师的第一行是决定；系统按它转交，不依赖模型是否写出可唤醒的 @。
  const routePlannerDecision = (room, stageIndex, turn) => {
    const messages = store.readMessages(roomId)
    const latestVerdict = [...messages].reverse()
      .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === stageIndex)
    if (latestVerdict === undefined || latestVerdict.meta?.pass !== false) return false
    const verdictIndex = messages.indexOf(latestVerdict)
    if (messages.slice(verdictIndex + 1).some(message => (
      message.kind === 'evidence' && (message.meta?.stage ?? 0) === stageIndex
    ))) return false
    const verdictId = latestVerdict.id ?? latestVerdict.seq
    if (room.lastPlannerDecision?.verdictId === verdictId) return false

    const decision = parsePlannerDecision(turn.reply)
    store.updateRoom(roomId, current => {
      current.lastPlannerDecision = { stage: stageIndex, verdictId, kind: decision.kind, at: Date.now() }
      return { events: [] }
    })
    const stage = room.stages?.[stageIndex]
    if (decision.kind !== 'rework') return true
    const target = (stage?.assignees ?? []).find(id => workerIds(room).includes(id)) ?? workerIds(room)[0]
    if (typeof target !== 'string' || target === '') {
      store.appendMessage(roomId, { kind: 'system', text: '这一步没有执行成员，规划师没法把返工交出去。' })
      return true
    }
    const name = memberDisplayName(room, target)
    const mention = `@${name}`
    void handoff.trigger({
      room,
      stage,
      index: stageIndex,
      from: leadMemberOf(room)?.id,
      to: target,
      reason: 'rework',
      prompt: [
        `${mention} 验收员退回了第 ${stageIndex + 1} 步「${stage?.title ?? ''}」。`,
        `规划师的返工要求：${decision.note}`,
        '只重做这一步；完成后不要 @ 人，系统会交给验收员。',
        INTERNAL_PROMPT_MARKER,
      ].join('\n'),
      acceptance: stage?.acceptance ?? '',
      rework: true,
    }).catch(error => {
      store.appendMessage(roomId, { kind: 'system', text: `没能把返工交给${name}：${error?.message ?? error}` })
    })
    return true
  }

  const captureTurn = (turn, authorRef) => {
    const turnId = turn?.turnId
    if (typeof turnId !== 'string' || state.capturedTurns.has(turnId)) return
    const room = store.readRoom(roomId)
    const memberId = memberForRef(room, authorRef)
    const role = memberOf(room, memberId)?.role
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room === null ? null : dispatchOf(store, roomId, stageIndex)
    const assignment = memberId === null || room === null
      ? null
      : assignmentForTurn(store, roomId, stageIndex, memberId, turnId)
    const parallel = (dispatch?.workers?.length ?? 0) > 1
    const pendingForMember = role === 'worker' &&
      assignment !== null &&
      ['created', 'sent', 'working'].includes(assignment.status) &&
      assignment.context?.parallel === true

    if ((turn.toolCalls ?? 0) === 0 && (turn.reply ?? '') === '') {
      if (pendingForMember) {
        state.capturedTurns.add(turnId)
        if (assignment !== null) updateAssignment(store, assignment.id, { status: 'failed', resultText: '没有产出' })
        store.appendMessage(roomId, {
          kind: 'system',
          text: `并行执行：${memberDisplayName(room, memberId)} 这一回合没有产出；继续等其它成员。`,
        })
        const done = integrator.settle(memberId, turnId, true)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            store.appendMessage(roomId, { kind: 'system', text: '并行执行：所有执行成员都没有产出；这一步还没有进入验收。' })
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

    if (review.consume({ turn, memberId, turnId, room })) {
      state.recordTurn(true)
      return
    }

    store.appendEvent(roomId, 'turn.completed', { turnId, memberId: memberId ?? 'unknown' })
    if (role === 'lead' && routePlannerDecision(room, stageIndex, turn)) {
      state.recordTurn(false)
      return
    }
    if (role !== 'worker') {
      state.recordTurn(false)
      return
    }

    const calls = state.turns.get(turnId) ?? []
    state.turns.delete(turnId)
    const stage = stageIndex

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
            store.appendMessage(roomId, { kind: 'system', text: `没法准备检查副本（${memberDisplayName(current, memberId)}）：${error?.message ?? error}` })
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
        if (assignment !== null) updateAssignment(store, assignment.id, { status: 'reported', turnId, evidenceIds: [stored.id], ...(candidate === null ? {} : { candidate }) })
        store.appendEvent(roomId, 'turn.evidence', { stage, turnId, memberId })
        state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

        const done = integrator.settle(memberId, turnId, false)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            store.appendMessage(roomId, { kind: 'system', text: '并行执行：没有可合并的执行成员；这一步还没有进入验收。' })
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
        if (latest?.meta?.pass === true) return
        await integrator.integrate({ stageIndex: stage, workers: [memberId], base: workspaceOf(current).head({ path: current.repoPath }), turnId })
      })
      return
    }

    const storedEvidence = store.appendMessage(roomId, evidence)
    if (assignment !== null) {
      updateAssignment(store, assignment.id, { status: 'reported', turnId, evidenceIds: [storedEvidence.id] })
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
      } else if (command !== '' && target?.kind === 'deliverable' && target.state === 'active' && worked && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        void acceptance.run(stage, command, turnId)
      }
    }
  }

  // 服务重启后以已落盘的消息为准续跑：缺回合就重新派发，缺验收就重跑命令，待复核就重发请求，待集成就先合并。
  const resumeOnce = async ({ forceAcceptance = false } = {}) => {
    const room = store.readRoom(roomId)
    if (room === null || room.live !== true || room.state !== 'active') return
    if (room.busy === true || workerIds(room).length === 0) return
    const stageIndex = room.stages.findIndex(stage => stage.state === 'active')
    if (stageIndex < 0) return
    const stage = room.stages[stageIndex]
    if (!isWorkStage(stage) && stage.manual !== true) return

    const messages = store.readMessages(roomId)
    const evidence = messages.filter(message => (
      message.kind === 'evidence' &&
      (message.meta?.stage ?? 0) === stageIndex &&
      (room.demo === true || message.meta?.simulated !== true)
    ))
    const latestTurn = [...evidence].reverse().find(message => message.meta?.kind === 'turn')
    const latestCommand = [...evidence].reverse().find(message => message.meta?.kind === 'command')
    const latestManual = [...evidence].reverse().find(message => message.meta?.kind === 'manual')
    const latestTurnSeq = latestTurn?.seq ?? -1
    const dispatch = dispatchOf(store, roomId, stageIndex)

    if (!forceAcceptance && latestCommand !== undefined && (latestCommand.seq ?? 0) > latestTurnSeq) {
      if (latestCommand.meta?.exit !== 0) return
      const outcome = reviewState({ room, evidence: store.readEvidence?.(roomId), messages, stageIndex })
      if (outcome.state !== 'pending') return
      try {
        await review.request(stageIndex)
      } catch (error) {
        store.appendMessage(roomId, { kind: 'system', text: `重启后复核未恢复：${error?.message ?? error}` })
      }
      return
    }

    if (dispatch?.stage === stageIndex) {
      if (stage.manual === true && latestManual !== undefined && (latestManual.seq ?? 0) > latestTurnSeq) return
      if (dispatch.stalled === true) return
      if (dispatch.timedOut === true) {
        for (const item of activeDispatch(store, roomId, stageIndex)) {
          if (item.flags?.timedOut !== true) continue
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), timedOut: false } })
        }
      }
      const reported = new Set(
        evidence.filter(message => message.meta?.kind === 'turn').map(message => message.authorId),
      )
      const failed = [...new Set([
        ...(dispatch.failed ?? []),
        ...(dispatch.workers ?? []).filter(worker => !reported.has(worker)),
      ])]
      const workers = (dispatch.workers ?? []).filter(worker => reported.has(worker) && !failed.includes(worker))
      if (workers.length === 0) {
        for (const item of activeDispatch(store, roomId, stageIndex)) {
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), stalled: true } })
        }
        store.appendMessage(roomId, { kind: 'system', text: '重启后并行执行仍没有产出；这一步需要你处理。' })
        emit?.('room', store.readRoom(roomId))
        return
      }
      await integrator.enqueue(() => integrator.integrate({
        stageIndex,
        workers,
        base: dispatch.base ?? workspaceOf(room).head({ path: room.repoPath }),
        turnId: latestTurn?.meta?.turnId ?? '',
        failed,
      }))
      return
    }

    if (stage.manual === true) {
      if (latestManual !== undefined && (latestManual.seq ?? 0) > latestTurnSeq) return
      if (latestTurn === undefined) {
        await stageStarter.startStage(room, stageIndex)
        return
      }
      if (typeof latestTurn.meta?.turnId === 'string') markManualReady(room, stageIndex, latestTurn.meta.turnId)
      return
    }

    if (latestTurn === undefined) {
      if (dispatch?.stage === stageIndex && (dispatch.stalled === true || dispatch.timedOut === true)) return
      await stageStarter.startStage(room, stageIndex)
      return
    }

    const command = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
    if (command !== '' && typeof latestTurn.meta?.turnId === 'string') {
      await acceptance.run(stageIndex, command, latestTurn.meta.turnId)
    }
  }

  const resume = async options => {
    try {
      await resumeOnce(options)
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `重启后未能自动续跑：${error?.message ?? error}` })
    }
  }

  return {
    seed: state.seed,
    trackTool: state.trackTool,
    captureTurn,
    resume,
    requestReview: review.request,
    startStage: stageStarter.startStage,
    busyReview: review.isBusy,
  }
}
