import { createHash } from 'node:crypto'
import { mcpCalls } from './mcp.js'
import { recordMcpFailures } from './mcp-breaker.js'
import { markTask } from './tasks.js'
import { seatDisplayName } from './seat-labels.js'
import { reviewState } from './verifiers.js'
import { createAcceptanceRunner } from './live-acceptance.js'
import { createStageIntegrator } from './live-integration.js'
import { createReviewCoordinator } from './live-review.js'
import { createStageStarter } from './live-stage.js'
import { createTurnState } from './live-turn-state.js'
import { parsePlannerTool } from './planner-tools.js'
import { deliverableStageIndex, isWorkStage, seatOf } from './live-turn-utils.js'
import { vcsOf, workspaceOf } from './live-workspace.js'

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, roomId, emit, sendToSeat, commands, files, skills, advisor = null, onPlannerTool = null }) => {
  const state = createTurnState({ store, roomId, emit })
  const review = createReviewCoordinator({ store, roomId, emit, sendToSeat, updateTasks: state.updateTasks, advisor })
  const acceptance = createAcceptanceRunner({
    store,
    roomId,
    markProgress: state.markProgress,
    requestReview: review.request,
    updateTasks: state.updateTasks,
    run: commands.run,
  })
  const integrator = createStageIntegrator({
    store,
    roomId,
    emit,
    updateTasks: state.updateTasks,
    markProgress: state.markProgress,
    requestReview: review.request,
    run: commands.run,
  })
  const stageStarter = createStageStarter({
    store,
    roomId,
    emit,
    sendToSeat,
    updateTasks: state.updateTasks,
    integrate: integrator.integrate,
    enqueue: integrator.enqueue,
    skills,
  })

  const markManualReady = (room, stageIndex, turnId, worked) => {
    // 人工阶段没有命令可判“无改动”：没有实际工作的重复回报只更新记录，不重复生成验收证据。
    const existing = store.readMessages(roomId).some(message => (
      message.kind === 'evidence' &&
      message.meta?.kind === 'manual' &&
      (message.meta?.stage ?? 0) === stageIndex
    ))
    if (existing && !worked) return
    try {
      if (workspaceOf(room).capabilities().candidate === true) {
        const candidate = workspaceOf(room).submit({ path: room.repoPath, turnId, name: room.name })
        if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
      }
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `候选提交失败：${error?.message ?? error}` })
    }
    const hasVerifier = (room.verifiers?.length ?? 0) > 0
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: hasVerifier ? '产物已就绪，等验收员复核。' : '产物已就绪，等你验收。',
      meta: {
        kind: 'manual',
        stage: stageIndex,
        turnId,
        repoPath: room.repoPath,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    store.appendMessage(roomId, { kind: 'system', text: hasVerifier ? '产物已就绪 · 等验收员复核' : '产物已就绪 · 等你验收' })
    state.markProgress()
    if (hasVerifier) {
      void review.request(stageIndex).catch(error => {
        store.appendMessage(roomId, { kind: 'system', text: `人工验收复核未启动：${error?.message ?? error}` })
      })
    }
  }

  const captureTurn = (turn, authorRef) => {
    const turnId = turn?.turnId
    if (typeof turnId !== 'string' || state.capturedTurns.has(turnId)) return
    const room = store.readRoom(roomId)
    const seat = seatOf(room, authorRef)
    const role = room?.seatSpecs?.find(item => item.id === seat)?.role
    const parallel = (room?.workers?.length ?? 0) > 1
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room?.stageDispatch
    const pendingForSeat = role === 'worker' &&
      dispatch?.stage === stageIndex &&
      (dispatch.pending ?? []).includes(seat)

    if ((turn.toolCalls ?? 0) === 0 && (turn.reply ?? '') === '') {
      if (pendingForSeat) {
        state.capturedTurns.add(turnId)
        state.updateTasks(stageIndex, current => markTask(current, seat, 'failed'))
        store.appendMessage(roomId, {
          kind: 'system',
          text: `并行执行：${seatDisplayName(room, seat)} 这一回合没有产出；继续等其它席位。`,
        })
        const done = integrator.settle(seat, turnId, true)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            store.appendMessage(roomId, { kind: 'system', text: '并行执行：所有执行席位都没有产出；阶段仍未进入验收。' })
            const updated = store.updateRoom(roomId, current => {
              const currentDispatch = current.stageDispatch
              if (currentDispatch === null || currentDispatch === undefined) return null
              if (currentDispatch.stage !== done.stageIndex || (currentDispatch.pending ?? []).length > 0) return null
              currentDispatch.stalled = true
              return { events: [] }
            })
            if (updated !== null) emit?.('room', updated)
          } else {
            void integrator.enqueue(() => integrator.integrate({ ...done, workers: remaining, turnId }))
          }
        }
      }
      return
    }
    state.capturedTurns.add(turnId)

    if (role === 'lead') {
      const tool = parsePlannerTool(turn.reply)
      if (tool !== null && typeof onPlannerTool === 'function') {
        void Promise.resolve(onPlannerTool({ room, seat, tool, turnId }))
          .then(result => {
            const text = result?.ok === false
              ? `Planner 工具失败（${tool.name}）：${result.error ?? '未知原因'}`
              : `Planner 工具已执行：${tool.name}`
            store.appendMessage(roomId, { kind: 'system', text })
            const name = room?.seatNames?.[seat]
            if (typeof name === 'string' && name !== '') {
              void sendToSeat(seat, `@${name} ${text}。继续当前阶段；如仍需工具，再按协议调用。`).catch(() => {})
            }
          })
          .catch(error => {
            store.appendMessage(roomId, { kind: 'system', text: `Planner 工具失败（${tool.name}）：${error?.message ?? error}` })
          })
        state.recordTurn(false)
        return
      }
    }

    const mcp = mcpCalls(turn.tools)
    if (mcp.length > 0) {
      store.appendEvent(roomId, 'mcp.call', { seat, stage: stageIndex, turnId, calls: mcp })
      const failed = mcp.filter(call => call.failed > 0)
      if (failed.length > 0) {
        store.appendEvent(roomId, 'mcp.failure', { seat, turnId, calls: failed })
        const { breakers, tripped } = recordMcpFailures(room?.mcpBreakers, failed)
        const updated = store.updateRoom(roomId, current => {
          current.mcpBreakers = breakers
          return {
            events: tripped.map(server => ({ type: 'mcp.trip', payload: { server, seat, turnId } })),
          }
        })
        if (updated !== null) emit?.('room', updated)
        store.appendMessage(roomId, {
          kind: 'system',
          text: tripped.length === 0
            ? `MCP 工具失败已隔离：${failed.map(call => `${call.server}/${call.tool} ×${call.failed}`).join('、')}；只影响 ${seatDisplayName(room, seat)} 这一回合，房间继续。`
            : `MCP 熔断：${tripped.join('、')}；使用它的席位回合暂停，恢复后继续。`,
        })
      }
    }

    if (review.consume({ turn, seat, turnId, room })) {
      state.recordTurn(true)
      return
    }

    store.appendEvent(roomId, 'turn.completed', { turnId, seat: seat ?? 'unknown' })
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
      authorId: seat ?? 'worker',
      text: turn.reply || summary,
      meta: {
        kind: 'turn',
        vcs: vcsOf(room),
        mcp,
        stage,
        turnId,
        summary,
        durationMs: turn.durationMs,
        files: artifacts.map(item => item.path.split('/').at(-1)),
        artifacts,
        output: JSON.stringify({
          tools: turn.tools ?? [],
          toolCalls: turn.toolCalls,
          usage: turn.usage,
          hookCoverage: turn.hookCoverage,
        }, null, 2),
        capturedAt: new Date().toISOString(),
      },
    }

    if (parallel) {
      void integrator.enqueue(async () => {
        const current = store.readRoom(roomId)
        if (current === null) return
        const worktree = current.worktrees?.[seat]
        let candidate = null
        if (worktree !== undefined && workspaceOf(current).capabilities().candidate === true) {
          try {
            candidate = workspaceOf(current).submit({ path: worktree, turnId, name: current.name })
            if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage, turnId, seat, commit: candidate })
          } catch (error) {
            store.appendMessage(roomId, { kind: 'system', text: `候选提交失败（${seatDisplayName(current, seat)}）：${error?.message ?? error}` })
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
            branch: current.branches?.[seat] ?? '',
            head,
            diff: range.diff,
            manifest: range.manifest ?? [],
            changedFiles: range.files,
            candidate,
          },
        })
        state.updateTasks(stage, stageState => markTask(stageState, seat, 'reported', stored.id))
        store.appendEvent(roomId, 'turn.evidence', { stage, turnId, seat })
        state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

        const done = integrator.settle(seat, turnId, false)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            store.appendMessage(roomId, { kind: 'system', text: '并行执行：没有可合并的执行席位；阶段仍未进入验收。' })
          } else {
            await integrator.integrate({ ...done, workers: remaining, turnId })
          }
          return
        }
        if (pendingForSeat) return
        if (dispatch !== null && dispatch !== undefined && dispatch.stage !== stage) return
        const active = current.stages[stage]
        if (active === undefined || !isWorkStage(active) || active.state !== 'active') return
        if (review.isBusy()) return
        const latest = [...store.readMessages(roomId)].reverse()
          .find(message => message.kind === 'verdict' && message.meta?.stage === stage)
        if (latest?.meta?.pass === true) return
        await integrator.integrate({ stageIndex: stage, workers: [seat], base: workspaceOf(current).head({ path: current.repoPath }), turnId })
      })
      return
    }

    const storedEvidence = store.appendMessage(roomId, evidence)
    if (seat !== null && seat !== undefined) {
      state.updateTasks(stage, stageState => markTask(stageState, seat, 'reported', storedEvidence.id))
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
    if (room.busy === true || (room.workers?.length ?? 0) === 0) return
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
    const dispatch = room.stageDispatch

    if (!forceAcceptance && latestCommand !== undefined && (latestCommand.seq ?? 0) > latestTurnSeq) {
      if (latestCommand.meta?.exit !== 0) return
      const outcome = reviewState({ room, messages, stageIndex })
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
        store.updateRoom(roomId, current => {
          const currentDispatch = current.stageDispatch
          if (currentDispatch?.stage !== stageIndex || currentDispatch.timedOut !== true) return null
          currentDispatch.timedOut = false
          return { events: [] }
        })
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
        const updated = store.updateRoom(roomId, current => {
          const currentDispatch = current.stageDispatch
          if (currentDispatch?.stage !== stageIndex || currentDispatch.stalled === true) return null
          currentDispatch.stalled = true
          return { events: [{ type: 'stage.dispatch_stalled', payload: { stage: stageIndex, workers: dispatch.workers ?? [] } }] }
        })
        if (updated !== null) {
          store.appendMessage(roomId, { kind: 'system', text: '重启后并行执行仍没有产出；阶段等你处理。' })
          emit?.('room', updated)
        }
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
