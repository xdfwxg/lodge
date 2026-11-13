import { markStageTasks } from './tasks.js'
import { reworkFloor } from './verifiers.js'
import { vcsOf, workspaceOf } from './live-workspace.js'

export const createAcceptanceRunner = ({ store, roomId, markProgress, requestReview, updateTasks, run }) => {
  let chain = Promise.resolve()

  const runAcceptance = async (stageIndex, command, turnId) => {
    const room = store.readRoom(roomId)
    if (room === null) return
    if (typeof room.repoPath !== 'string' || room.repoPath === '') {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `阶段 ${stageIndex + 1} 有验收命令，但房间没有固定工作目录，验收未执行`,
      })
      return
    }
    const capabilities = workspaceOf(room).capabilities()
    if (capabilities.acceptanceCopy !== true) {
      store.appendMessage(roomId, { kind: 'system', text: '当前工作区不支持一次性验收副本，验收未执行' })
      return
    }
    // diff 必须在候选提交前采集：提交后工作树变干净，provider 会看不到交付改动。
    let diff = await workspaceOf(room).changes({ path: room.repoPath })
    const changed = (diff.files?.length ?? 0) > 0 || (diff.manifest?.length ?? 0) > 0
    const head = typeof workspaceOf(room).head === 'function'
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    const baseline = room.stageBases?.[stageIndex] ?? null
    const advanced = baseline !== null && typeof head === 'string' && head !== '' && head !== baseline
    if (!changed && advanced && typeof workspaceOf(room).rangeChanges === 'function') {
      // 执行者自己 commit 时工作树是干净的，证据要补上“阶段起点 → 当前 HEAD”的改动。
      try {
        const range = await workspaceOf(room).rangeChanges({ path: room.repoPath, base: baseline })
        if ((range.files?.length ?? 0) > 0 || range.diff !== '') diff = { ...diff, ...range }
      } catch {}
    }
    if (!changed && capabilities.candidate === true) {
      const messages = store.readMessages(roomId)
      const floor = reworkFloor(messages, stageIndex)
      const prior = [...messages].reverse().find(message => (
        message.kind === 'evidence' &&
        message.meta?.kind === 'command' &&
        (message.meta?.stage ?? 0) === stageIndex &&
        (message.seq ?? 0) > floor &&
        message.meta?.exit === 0
      ))
      const covered = prior?.meta?.head ?? prior?.meta?.candidate ?? null
      const currentHead = typeof head === 'string' && head !== '' ? head : null
      // 工作树干净不等于没有交付：执行者可能自己 commit，或返工 amend 了候选提交。
      const coveredByPrior = prior !== undefined && (covered === null || currentHead === null || covered === currentHead)
      if (coveredByPrior || (prior === undefined && floor < 0 && !advanced)) {
        const note = prior !== undefined
          ? '本轮无新增交付改动，沿用已完成的验收。'
          : '本轮没有可验收的交付改动，验收未执行。'
        const lastSystem = [...messages].reverse().find(message => message.kind === 'system')
        if (lastSystem?.text !== note) store.appendMessage(roomId, { kind: 'system', text: note })
        return
      }
    }
    let candidate = null
    try {
      candidate = capabilities.candidate === true
        ? workspaceOf(room).submit({ path: room.repoPath, turnId, name: room.name })
        : null
      if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `候选提交失败，验收未执行：${error?.message ?? error}` })
      return
    }
    // 本轮实际被验收的提交：有候选就是候选，否则是执行者自己 commit 的房间 HEAD。
    const acceptedRef = candidate ?? head
    let copy
    try {
      // 不能用源仓库的 HEAD；执行者自己 commit 时房间 HEAD 才是交付。
      copy = workspaceOf(room).isolatedCopy({ source: room.sourceRepo, ref: acceptedRef ?? 'HEAD' })
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `验收隔离副本创建失败，验收未执行：${error?.message ?? error}` })
      return
    }
    const port = room.ports?.[room.workers?.[0]]
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
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: `验收命令 \`${command}\` 已在一次性验收副本执行，退出码 ${result.exit === null ? '无' : result.exit}。`,
      meta: {
        kind: 'command',
        vcs: vcsOf(room),
        stage: stageIndex,
        command,
        exit: result.exit,
        output: result.output,
        diff: diff.diff,
        status: diff.status,
        files: diff.files,
        manifest: diff.manifest ?? [],
        changedFiles: diff.files,
        note: [result.timedOut ? '命令超时' : '', diff.note].filter(Boolean).join(' · '),
        durationMs: result.durationMs,
        repoPath: room.repoPath,
        commandCwd: copy.path,
        isolated: true,
        sandbox: result.sandbox,
        candidate,
        head: typeof acceptedRef === 'string' && acceptedRef !== '' ? acceptedRef : null,
        turnId,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    store.appendEvent(roomId, 'acceptance.run', {
      stage: stageIndex,
      command,
      exit: result.exit,
      durationMs: result.durationMs,
      isolated: true,
      sandbox: result.sandbox,
      candidate,
    })
    store.appendMessage(roomId, {
      kind: 'system',
      text: result.exit === 0
        ? '验收命令完成 · exit 0 · 等待独立复核'
        : `验收命令未通过 · exit ${result.exit === null ? '无' : result.exit} · 返工后才能复核`,
    })
    if (result.exit !== 0) {
      updateTasks(stageIndex, current => markStageTasks(current, 'working'))
      return
    }
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

  const schedule = (stageIndex, command, turnId) => {
    chain = chain
      .then(() => runAcceptance(stageIndex, command, turnId))
      .catch(error => {
        store.appendMessage(roomId, { kind: 'system', text: `验收命令执行出错：${error?.message ?? error}` })
      })
    return chain
  }

  return { run: schedule }
}
