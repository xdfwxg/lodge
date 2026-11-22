import { verifierIds, workerIds } from '../../room-members.js'
import { systemNotice } from '../../notices.js'
import { redactSecrets } from '../../../../shared/secrets.js'
import { reworkFloor } from './verifiers.js'
import { vcsOf, workspaceOf } from './workspace.js'

export const createAcceptanceRunner = ({
  store,
  roomId,
  emit,
  markProgress,
  requestReview,
  run,
  onAutoPass = null,
  onAutoFail = null,
}) => {
  let chain = Promise.resolve()

  const runAcceptance = async (stageIndex, command, turnId, { auto = false, reason = '' } = {}) => {
    const room = store.readRoom(roomId)
    if (room === null) return
    if (typeof room.repoPath !== 'string' || room.repoPath === '') {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `第 ${stageIndex + 1} 步需要检查，但房间还没有工作文件夹，检查没有执行`,
      })
      return
    }
    const capabilities = workspaceOf(room).capabilities()
    if (capabilities.acceptanceCopy !== true) {
      systemNotice({ store, roomId, text: '这个文件夹没法单独检查；结果由你确认。' })
      return
    }
    // diff 必须在候选提交前采集：提交后工作树变干净，provider 会看不到交付改动。
    let diff = await workspaceOf(room).changes({ path: room.repoPath })
    const changed = (diff.files?.length ?? 0) > 0 || (diff.manifest?.length ?? 0) > 0
    const head = typeof workspaceOf(room).head === 'function'
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    const baseline = room.stageBases?.[stageIndex] ?? room.startHead ?? null
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
      // 工作树干净不等于没有交付：执行者可能自己 commit，或重做 amend 了候选提交。
      const coveredByPrior = prior !== undefined && (covered === null || currentHead === null || covered === currentHead)
      if (coveredByPrior || (prior === undefined && floor < 0 && !advanced)) {
        const note = prior !== undefined
          ? '这次没有新的改动，沿用上次的检查结果。'
          : '本轮没有可验收的交付改动，验收未执行。'
        const lastSystem = [...messages].reverse().find(message => message.kind === 'system')
        if (lastSystem?.text !== note) store.appendMessage(roomId, { kind: 'system', text: note })
        // 返工后没有任何新改动：不能再静默停下，房间要等人处理。
        if (floor >= 0) {
          const updated = store.updateRound(roomId, current => {
            if (current.blocked?.stage === stageIndex && current.blocked?.reason === 'no-progress') return null
            current.blocked = { stage: stageIndex, reason: 'no-progress', workers: [], at: Date.now() }
            return { events: [{ type: 'stage.blocked', payload: { stage: stageIndex, reason: 'no-progress' } }] }
          })
          if (updated !== null) emit?.('room', updated)
        }
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
      systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
      return
    }
    // 本轮实际被验收的提交：有候选就是候选，否则是执行者自己 commit 的房间 HEAD。
    const acceptedRef = candidate ?? head
    // 单执行官用 clone 工作区，候选提交只存在于房间仓库；从房间仓库做隔离副本。
    const copySource = typeof room.repoPath === 'string' && room.repoPath !== '' ? room.repoPath : room.sourceRepo
    let copy
    try {
      copy = workspaceOf(room).isolatedCopy({ source: copySource, ref: acceptedRef ?? 'HEAD' })
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
      return
    }
    const port = room.ports?.[workerIds(room)[0]]
    let result
    try {
      result = await run({
        command,
        cwd: copy.path,
        env: port === undefined ? undefined : { PORT: String(port) },
        sandbox: true,
      })
    } finally {
      workspaceOf(room).removeIsolatedCopy({ source: copySource, copy })
    }
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: `${auto ? '自动检查' : '检查'}${result.exit === 0 ? '通过' : '没通过'}；这次检查在独立副本里执行。`,
      meta: {
        kind: 'command',
        ...(auto ? { auto: true } : {}),
        ...(reason === '' ? {} : { detected: reason }),
        vcs: vcsOf(room),
        stage: stageIndex,
        command: redactSecrets(command),
        exit: result.exit,
        output: redactSecrets(result.output),
        diff: redactSecrets(diff.diff),
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
      ...(auto ? { auto: true } : {}),
    })
    if (auto === true) {
      if (result.exit === 0) {
        markProgress()
        onAutoPass?.({ stageIndex, command })
      } else {
        // 没通过就退回重做；失败本身留在证据里，不往时间线里再喊一遍。
        await onAutoFail?.({ stageIndex, command, exit: result.exit, output: result.output })
      }
      return
    }
    if (result.exit !== 0) {
      systemNotice({ store, roomId, text: '检查没通过 · 需要重做这一步' })
      // 检查没通过不能静默停下：把房间标成等人处理，岛和侧栏都能看见。
      const updated = store.updateRound(roomId, current => {
        if (current.blocked?.stage === stageIndex && current.blocked?.reason === 'check-failed') return null
        current.blocked = { stage: stageIndex, reason: 'check-failed', command, at: Date.now() }
        return { events: [{ type: 'stage.blocked', payload: { stage: stageIndex, reason: 'check-failed' } }] }
      })
      if (updated !== null) emit?.('room', updated)
      return
    }
    markProgress()
    if (verifierIds(room).length > 0) {
      try {
        await requestReview(stageIndex)
      } catch (error) {
        systemNotice({ store, roomId, text: '检查做完了，但没能叫验收员来看；结果还在房间里。', error })
      }
    }
  }

  const schedule = (stageIndex, command, turnId, options = {}) => {
    chain = chain
      .then(() => runAcceptance(stageIndex, command, turnId, options))
      .catch(error => {
        systemNotice({ store, roomId, text: '这次检查没跑完；结果还在房间里。', error })
      })
    return chain
  }

  return { run: schedule }
}
