import { verifierIds } from '../../room-members.js'
import { isWorkStage } from './turn-utils.js'
import { vcsOf, workspaceOf } from './workspace.js'
import { memberDisplayName } from '../../member-labels.js'
import { systemNotice } from '../../notices.js'
import { activeDispatchAssignments, transitionAssignment, updateAssignment } from '../../assignments.js'
import { dispatchOf } from '../../assignment-projections.js'

export const createStageIntegrator = ({ store, roomId, emit, markProgress, requestReview, run }) => {
  let chain = Promise.resolve()

  // 合并、集成验收都串行执行，避免多个回合同时动集成 worktree。
  const enqueue = task => {
    chain = chain.then(task).catch(error => {
      systemNotice({ store, roomId, text: '合改动时出了点问题；需要你处理。', error })
    })
    return chain
  }

  const settleWorker = (member, turnId, failed) => {
    const assignment = store.readAssignments(roomId, { limit: 1000 })
      .filter(item => item.toMemberId === member && ['dispatch', 'rework', 'retry'].includes(item.reason))
      .at(-1)
    if (assignment === undefined) return null
    if (failed) transitionAssignment(store, assignment.id, 'failed', { turnId })
    store.appendEvent(roomId, failed ? 'stage.member_failed' : 'stage.member_done', { stage: assignment.stageIndex, member, turnId })
    const dispatch = dispatchOf(store, roomId, assignment.stageIndex)
    if (dispatch === null || dispatch.pending.length > 0) return null
    return {
      stageIndex: assignment.stageIndex,
      workers: [...dispatch.workers],
      base: dispatch.base,
      failed: [...dispatch.failed],
    }
  }

  const clearBlocked = stageIndex => {
    const updated = store.updateRoom(roomId, current => {
      if (current.blocked?.stage !== stageIndex) return null
      current.blocked = null
      return { events: [] }
    })
    if (updated !== null) emit?.('room', updated)
  }

  // 合并结果已经在一个提交上：人工验收就走人工证据，命令验收在独立副本里跑检查，
  // 两种情况都要把验收员叫醒，不能停在“可以验收了”。
  const acceptHead = async ({ room, stage, stageIndex, head, workers, base, merged = [], turnId = '' }) => {
    const integration = room.repoPath
    if (typeof head !== 'string' || head === '') {
      systemNotice({ store, roomId, text: '合并结果没有留下提交；需要你处理。' })
      return
    }
    for (const item of activeDispatchAssignments(store, roomId, stageIndex)) {
      updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), integrated: true } })
    }
    if (stage.manual === true) {
      store.appendMessage(roomId, {
        kind: 'evidence',
        authorId: 'system',
        text: '并行结果已合并，可以验收了。',
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
      systemNotice({ store, roomId, text: '改动已经合到一起 · 可以验收了' })
      store.appendEvent(roomId, 'room.integration', { stage: stageIndex, head, workers, merged, manual: true })
      clearBlocked(stageIndex)
      markProgress()
      if (verifierIds(room).length > 0) {
        try {
          await requestReview(stageIndex)
        } catch (error) {
          systemNotice({ store, roomId, text: '结果已经合到一起，但没能叫验收员来看；需要你处理。', error })
        }
      }
      return
    }
    const range = await workspaceOf(room).rangeChanges({ path: integration, base })
    const command = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
    if (command === '') {
      systemNotice({ store, roomId, text: `第 ${stageIndex + 1} 步没有检查方式；结果由你确认。` })
      return
    }
    let copy
    try {
      copy = workspaceOf(room).isolatedCopy({ source: room.sourceRepo, ref: head })
    } catch (error) {
      systemNotice({ store, roomId, text: '集成检查没跑成；结果由你确认。', error })
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
    const names = workers.map(worker => memberDisplayName(room, worker)).join('、')
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: `检查${result.exit === 0 ? '通过' : '没通过'}；这次检查在独立副本里执行。并行执行：${names}。`,
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
    clearBlocked(stageIndex)
    store.appendMessage(roomId, {
      kind: 'system',
      text: result.exit === 0
        ? '检查通过 · 等验收员看'
        : '检查没通过 · 重做后才能复核',
    })
    if (result.exit !== 0) return
    markProgress()
    if (verifierIds(room).length > 0) {
      try {
        await requestReview(stageIndex)
      } catch (error) {
        systemNotice({ store, roomId, text: '检查做完了，但没能叫验收员来看；结果还在房间里。', error })
      }
    } else {
      systemNotice({ store, roomId, text: '检查通过 · 这一步做完了' })
    }
  }

  const integrateStage = async ({ stageIndex, workers, base, turnId, failed = [] }) => {
    const room = store.readRoom(roomId)
    if (room === null) return
    const stage = room.stages[stageIndex]
    if (stage === undefined || !isWorkStage(stage) || stage.state !== 'active') return
    // 冲突已经挂出来了：等人在重做里拍板，不能让后续回合把冲突自动重试掉。
    if (room.mergeConflict?.stage === stageIndex) return
    const integration = room.repoPath
    if (typeof integration !== 'string' || integration === '') {
      systemNotice({ store, roomId, text: '改动没能合到一起；需要你处理。' })
      return
    }
    if (workspaceOf(room).capabilities().merge !== true) {
      systemNotice({ store, roomId, text: '这个文件夹没法合并多人改动；检查没有执行。' })
      return
    }

    const merged = []
    for (const worker of workers) {
      const branch = room.branches?.[worker]
      const source = room.worktrees?.[worker]
      if ((typeof branch !== 'string' || branch === '') && (typeof source !== 'string' || source === '')) continue
      const result = workspaceOf(room).integrate({
        path: integration,
        branch: branch ?? '',
        source,
        // 冲突留在工作目录里，等人解决并提交；不要 abort 把现场清掉。
        keepConflict: true,
      })
      if (!result.ok) {
        const name = memberDisplayName(room, worker)
        const label = typeof branch === 'string' && branch !== '' ? branch : '工作副本'
        const files = result.files.length > 0 ? result.files.join('、') : '未知文件'
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${name} 的 ${label} 和房间里的文件冲突（${files}）；冲突留在房间工作目录里，解决并提交后点继续。`,
        })
        store.appendEvent(roomId, 'stage.merge_conflict', { stage: stageIndex, worker, branch: branch ?? '', files: result.files })
        const updated = store.updateRoom(roomId, current => {
          const conflict = { stage: stageIndex, worker, branch, files: result.files, path: integration }
          current.mergeConflict = conflict
          if (current.blocked?.stage === stageIndex) current.blocked = null
          return { events: [] }
        })
        if (updated !== null) emit?.('room', updated)
        return
      }
      merged.push({ worker, branch })
    }

    // 合并结果先落成候选提交：验收副本必须能看见两份改动，不能只 checkout 到旧 HEAD。
    let candidate = null
    try {
      candidate = workspaceOf(room).capabilities().candidate === true
        ? workspaceOf(room).submit({ path: integration, turnId, name: room.name })
        : null
    } catch (error) {
      systemNotice({ store, roomId, text: '合改动时没能留下结果；需要你处理。', error })
      return
    }
    const head = candidate ?? workspaceOf(room).head({ path: integration })
    await acceptHead({ room, stage, stageIndex, head, workers, base, merged, turnId })
  }

  // 人解决完冲突后，直接用当前集成分支的 HEAD 验收，不再重新合并 worker 分支。
  const resolveStage = async stageIndex => {
    const room = store.readRoom(roomId)
    const stage = room?.stages?.[stageIndex]
    if (room === null || stage === undefined || stage.state !== 'active') return
    const integration = room.repoPath
    const head = typeof workspaceOf(room).head === 'function'
      ? workspaceOf(room).head({ path: integration })
      : null
    const dispatch = dispatchOf(store, roomId, stageIndex)
    await acceptHead({
      room,
      stage,
      stageIndex,
      head,
      workers: dispatch?.workers ?? [],
      base: dispatch?.base,
      merged: [],
    })
  }

  return { enqueue, settle: settleWorker, integrate: integrateStage, resolve: resolveStage }
}
