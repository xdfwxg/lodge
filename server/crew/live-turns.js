import { createHash } from 'node:crypto'
import { mcpCalls } from './mcp.js'
import { recordMcpFailures } from './mcp-breaker.js'
import { markTask } from './tasks.js'
import { createAcceptanceRunner } from './live-acceptance.js'
import { createStageIntegrator } from './live-integration.js'
import { createReviewCoordinator } from './live-review.js'
import { createStageStarter } from './live-stage.js'
import { createTurnState } from './live-turn-state.js'
import { deliverableStageIndex, isWorkStage, seatOf } from './live-turn-utils.js'
import { vcsOf, workspaceOf } from './live-workspace.js'

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, roomId, emit, sendToSeat, commands, files }) => {
  const state = createTurnState({ store, roomId, emit })
  const review = createReviewCoordinator({ store, roomId, emit, sendToSeat, updateTasks: state.updateTasks })
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
  })

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
          text: `并行执行：${room.seatNames?.[seat] ?? seat} 这一回合没有产出；继续等其它席位。`,
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
            ? `MCP 工具失败已隔离：${failed.map(call => `${call.server}/${call.tool} ×${call.failed}`).join('、')}；只影响 ${room?.seatNames?.[seat] ?? seat} 这一回合，房间继续。`
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
            store.appendMessage(roomId, { kind: 'system', text: `候选提交失败（${current.seatNames?.[seat] ?? seat}）：${error?.message ?? error}` })
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
        try {
          if (workspaceOf(room).capabilities().candidate === true) {
            const candidate = workspaceOf(room).submit({ path: room.repoPath, turnId, name: room.name })
            if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage, turnId, commit: candidate })
          }
        } catch (error) {
          store.appendMessage(roomId, { kind: 'system', text: `候选提交失败：${error?.message ?? error}` })
        }
        store.appendMessage(roomId, {
          kind: 'evidence',
          authorId: 'system',
          text: '产物已就绪，等你验收。',
          meta: {
            kind: 'manual',
            stage,
            turnId,
            repoPath: room.repoPath,
            simulated: false,
            capturedAt: new Date().toISOString(),
          },
        })
        store.appendMessage(roomId, { kind: 'system', text: '产物已就绪 · 等你验收' })
        state.markProgress()
      } else if (command !== '' && target?.kind === 'deliverable' && target.state === 'active' && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        void acceptance.run(stage, command, turnId)
      }
    }
  }

  return {
    seed: state.seed,
    trackTool: state.trackTool,
    captureTurn,
    requestReview: review.request,
    startStage: stageStarter.startStage,
    busyReview: review.isBusy,
  }
}
