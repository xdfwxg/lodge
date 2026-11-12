import { runCommand } from './acceptance.js'
import { isWorkStage, vcsOf, workspaceOf } from './live-turn-utils.js'
import { markTask } from './tasks.js'

export const createStageIntegrator = ({ store, roomId, emit, updateTasks, markProgress, requestReview, run = runCommand }) => {
  let chain = Promise.resolve()

  // 合并、集成验收都串行执行，避免多个回合同时动集成 worktree。
  const enqueue = task => {
    chain = chain.then(task).catch(error => {
      store.appendMessage(roomId, { kind: 'system', text: `并行执行出错：${error?.message ?? error}` })
    })
    return chain
  }

  const settleWorker = (seat, turnId, failed) => {
    let done = null
    const updated = store.updateRoom(roomId, current => {
      const dispatch = current.stageDispatch
      if (dispatch === null || dispatch === undefined) return null
      if (!Array.isArray(dispatch.pending) || !dispatch.pending.includes(seat)) return null
      dispatch.pending = dispatch.pending.filter(id => id !== seat)
      if (failed) dispatch.failed = [...new Set([...(dispatch.failed ?? []), seat])]
      if (dispatch.pending.length === 0) {
        done = {
          stageIndex: dispatch.stage,
          workers: [...dispatch.workers],
          base: dispatch.base,
          failed: [...(dispatch.failed ?? [])],
        }
      }
      return { events: [{ type: failed ? 'stage.seat_failed' : 'stage.seat_done', payload: { stage: dispatch.stage, seat, turnId } }] }
    })
    return updated === null ? null : done
  }

  const integrateStage = async ({ stageIndex, workers, base, turnId, failed = [] }) => {
    const room = store.readRoom(roomId)
    if (room === null) return
    const stage = room.stages[stageIndex]
    if (stage === undefined || !isWorkStage(stage) || stage.state !== 'active') return
    const integration = room.repoPath
    if (typeof integration !== 'string' || integration === '') {
      store.appendMessage(roomId, { kind: 'system', text: '房间没有集成工作目录，并行合并未执行' })
      return
    }
    if (workspaceOf(room).capabilities().merge !== true) {
      store.appendMessage(roomId, { kind: 'system', text: '当前工作区不支持分支合并，集成验收未执行' })
      return
    }

    if (failed.length > 0) {
      const nameOf = seat => room.seatNames?.[seat] ?? seat
      const partial = { failed: [...failed], workers: [...workers], at: Date.now() }
      const updated = store.updateRoom(roomId, current => {
        const target = current.stages[stageIndex]
        if (target === undefined) return null
        target.partial = partial
        return { events: [{ type: 'stage.partial', payload: { stage: stageIndex, failed, workers } }] }
      })
      if (updated !== null) emit?.('room', updated)
      store.appendMessage(roomId, {
        kind: 'system',
        text: `部分成功：${failed.map(nameOf).join('、')} 没有产出，继续用 ${workers.map(nameOf).join('、')} 验收。`,
      })
      updateTasks(stageIndex, current => failed.reduce((stageState, seat) => markTask(stageState, seat, 'failed'), current))
    }

    const merged = []
    for (const worker of workers) {
      const branch = room.branches?.[worker]
      const source = room.worktrees?.[worker]
      if ((typeof branch !== 'string' || branch === '') && (typeof source !== 'string' || source === '')) continue
      const result = workspaceOf(room).integrate({ path: integration, branch: branch ?? '', source })
      if (!result.ok) {
        const name = room.seatNames?.[worker] ?? worker
        const label = typeof branch === 'string' && branch !== '' ? branch : '工作副本'
        const files = result.files.length > 0 ? result.files.join('、') : '未知文件'
        store.appendMessage(roomId, {
          kind: 'system',
          text: `并行合并冲突：${name} 的 ${label} 与房间目录冲突（${files}）。合并已回滚，阶段停下等你处理。`,
        })
        store.appendEvent(roomId, 'stage.merge_conflict', { stage: stageIndex, worker, branch: branch ?? '', files: result.files })
        const updated = store.updateRoom(roomId, current => {
          const conflict = { stage: stageIndex, worker, branch, files: result.files }
          current.mergeConflict = conflict
          if (current.stageDispatch?.stage === stageIndex) current.stageDispatch.conflict = { worker, branch, files: result.files }
          return { events: [] }
        })
        if (updated !== null) emit?.('room', updated)
        return
      }
      merged.push({ worker, branch })
    }

    const head = workspaceOf(room).head({ path: integration })
    if (stage.manual === true) {
      store.appendMessage(roomId, {
        kind: 'evidence',
        authorId: 'system',
        text: '并行产物已合并，等你验收。',
        meta: {
          kind: 'manual',
          vcs: vcsOf(room),
          stage: stageIndex,
          workers,
          merges: merged,
          head,
          repoPath: integration,
          turnId,
          simulated: false,
          capturedAt: new Date().toISOString(),
        },
      })
      store.appendMessage(roomId, { kind: 'system', text: '并行产物已合并 · 等你验收' })
      store.appendEvent(roomId, 'room.integration', { stage: stageIndex, head, workers, merged, manual: true })
      markProgress()
      return
    }
    const range = await workspaceOf(room).rangeChanges({ path: integration, base })
    const command = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
    if (command === '') {
      store.appendMessage(roomId, { kind: 'system', text: `阶段 ${stageIndex + 1} 没有验收命令，未执行集成验收` })
      return
    }
    let copy
    try {
      copy = workspaceOf(room).isolatedCopy({ source: room.sourceRepo, ref: head })
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `集成验收副本创建失败，验收未执行：${error?.message ?? error}` })
      return
    }
    const port = room.ports?.integration
    let result
    try {
      result = await run({
        command,
        cwd: copy.path,
        env: port === undefined ? undefined : { PORT: String(port) },
        sandbox: true,
      })
    } finally {
      workspaceOf(room).removeIsolatedCopy({ source: room.sourceRepo, copy })
    }
    const names = workers.map(worker => room.seatNames?.[worker] ?? worker).join('、')
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: `验收命令 \`${command}\` 已在一次性集成验收副本执行，退出码 ${result.exit === null ? '无' : result.exit}。并行执行：${names}。`,
      meta: {
        kind: 'command',
        vcs: vcsOf(room),
        stage: stageIndex,
        command,
        exit: result.exit,
        output: result.output,
        diff: range.diff,
        status: range.files.map(file => `M ${file}`).join('\n'),
        files: range.files,
        manifest: range.manifest ?? [],
        changedFiles: range.files,
        note: result.timedOut ? '命令超时' : '',
        durationMs: result.durationMs,
        repoPath: integration,
        commandCwd: copy.path,
        isolated: true,
        sandbox: result.sandbox,
        turnId,
        workers,
        merges: merged,
        head,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    store.appendEvent(roomId, 'room.integration', { stage: stageIndex, head, workers, merged })
    store.appendEvent(roomId, 'acceptance.run', {
      stage: stageIndex,
      command,
      exit: result.exit,
      durationMs: result.durationMs,
      isolated: true,
      sandbox: result.sandbox,
    })
    store.appendMessage(roomId, {
      kind: 'system',
      text: result.exit === 0
        ? '验收命令完成 · exit 0 · 等待独立复核'
        : `验收命令未通过 · exit ${result.exit === null ? '无' : result.exit} · 返工后才能复核`,
    })
    if (result.exit !== 0) return
    markProgress()
    if ((room.verifiers?.length ?? 0) > 0) {
      try {
        await requestReview(stageIndex)
      } catch (error) {
        store.appendMessage(roomId, { kind: 'system', text: `自动复核未启动：${error?.message ?? error}` })
      }
    } else {
      store.appendMessage(roomId, { kind: 'system', text: '验收命令完成 · 这个房间没有独立验收席位 · 等你签字' })
    }
  }

  return { enqueue, settle: settleWorker, integrate: integrateStage }
}
