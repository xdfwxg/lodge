import { markStageTasks } from './tasks.js'
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
    const diff = await workspaceOf(room).changes({ path: room.repoPath })
    const changed = (diff.files?.length ?? 0) > 0 || (diff.manifest?.length ?? 0) > 0
    if (!changed && capabilities.candidate === true) {
      const messages = store.readMessages(roomId)
      const prior = messages.some(message => (
        message.kind === 'evidence' &&
        message.meta?.kind === 'command' &&
        (message.meta?.stage ?? 0) === stageIndex &&
        message.meta?.exit === 0
      ))
      const note = prior
        ? '本轮无新增交付改动，沿用已完成的验收。'
        : '本轮没有可验收的交付改动，验收未执行。'
      const lastSystem = [...messages].reverse().find(message => message.kind === 'system')
      if (lastSystem?.text !== note) store.appendMessage(roomId, { kind: 'system', text: note })
      return
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
    let copy
    try {
      copy = workspaceOf(room).isolatedCopy({ source: room.sourceRepo, ref: candidate ?? 'HEAD' })
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
