import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { runCommand } from './acceptance.js'
import { budgetStatus } from './budget.js'
import { advanceProgress, NO_PROGRESS_LIMIT } from './progress.js'
import { reject } from './result.js'
import { markSeatRead } from './watermarks.js'
import { blockedSeats, recordMcpFailures } from './mcp-breaker.js'
import { mcpCalls } from './mcp.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { buildTasks, markStageTasks, markTask } from './tasks.js'
import { reviewState, verifierIds } from './verifiers.js'
import { workspaceProvider } from './workspace.js'

const isWorkStage = stage => stage.kind === 'deliverable' || stage.manual === true

const deliverableStageIndex = room => {
  const active = room.stages.findIndex(stage => stage.state === 'active' && isWorkStage(stage))
  if (active >= 0) return active
  const pending = room.stages.findIndex(stage => stage.state === 'pending' && isWorkStage(stage))
  if (pending >= 0) return pending
  const first = room.stages.findIndex(stage => isWorkStage(stage))
  return first >= 0 ? first : 0
}

const ws = room => workspaceProvider(room)
const vcsOf = room => ws(room).capabilities().vcs ?? 'none'

const REVIEW_TIMEOUT = 10 * 60_000
const PARALLEL_TIMEOUT = 15 * 60_000

const seatOf = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const [seat, memberRef] of Object.entries(room?.seatBots ?? {})) {
    if (memberRef === ref) return seat
  }
  return null
}

const parseVerdict = reply => {
  const first = String(reply ?? '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '') ?? ''
  const head = first.replace(/^[*#>\s]+/, '').replace(/^(结论|判定|verdict)\s*[:：]?\s*/i, '')
  return /^PASS\b/i.test(head)
}

const tail = (text, limit) => {
  const value = String(text ?? '')
  return value.length > limit ? `…\n${value.slice(-limit)}` : value
}

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, engine, roomId, emit, sendToSeat }) => {
  let reviewRound = null
  let acceptanceChain = Promise.resolve()
  const turns = new Map()
  const capturedTurns = new Set()
  const acceptanceRuns = new Set()
  let integrationChain = Promise.resolve()

  // 合并、集成验收都串行执行，避免多个回合同时动集成 worktree。
  const enqueue = task => {
    integrationChain = integrationChain.then(task).catch(error => {
      store.appendMessage(roomId, { kind: 'system', text: `并行执行出错：${error?.message ?? error}` })
    })
    return integrationChain
  }

  const seed = messages => {
    for (const message of messages) {
      if ((message.kind === 'evidence' || message.kind === 'verdict') && typeof message.meta?.turnId === 'string') {
        capturedTurns.add(message.meta.turnId)
      }
    }
  }

  const trackTool = message => {
    if (message.kind !== 'activity' || typeof message.turnId !== 'string') return
    const calls = turns.get(message.turnId) ?? []
    if (message.tool?.id !== undefined && calls.some(call => call.id === message.tool.id)) return
    calls.push(message.tool ?? {})
    turns.set(message.turnId, calls)
  }

  const recordTurn = progressed => {
    let paused = false
    const updated = store.updateRoom(roomId, current => {
      const result = advanceProgress(current, { progressed })
      paused = result.paused
      return {
        events: [
          { type: 'room.turn', payload: { round: current.round, noProgress: current.noProgress, progressed } },
          ...(paused ? [{ type: 'room.idle', payload: { reason: 'no-progress' } }] : []),
        ],
      }
    })
    if (updated === null) return
    if (paused) {
      store.appendMessage(roomId, { kind: 'system', text: `连续 ${NO_PROGRESS_LIMIT} 轮没有产出，房间已暂停；等你说话。` })
    }
    emit?.('room', updated)
  }

  const markProgress = () => {
    const updated = store.updateRoom(roomId, current => {
      current.noProgress = 0
      current.lastProgressAt = Date.now()
      return { events: [{ type: 'room.progress', payload: { at: current.lastProgressAt } }] }
    })
    if (updated !== null) emit?.('room', updated)
  }

  const updateTasks = (stageIndex, mutate) => {
    const updated = store.updateRoom(roomId, current => {
      const stage = current.stages[stageIndex]
      if (stage === undefined) return null
      const next = mutate(stage)
      if (next === stage) return null
      current.stages[stageIndex] = next
      return { events: [] }
    })
    if (updated !== null) emit?.('room', updated)
  }

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
    const capabilities = ws(room).capabilities()
    if (capabilities.acceptanceCopy !== true) {
      store.appendMessage(roomId, { kind: 'system', text: '当前工作区不支持一次性验收副本，验收未执行' })
      return
    }
    // diff 必须在候选提交前采集：提交后工作树变干净，provider 会看不到交付改动。
    const diff = await ws(room).changes({ path: room.repoPath })
    let candidate = null
    try {
      candidate = capabilities.candidate === true
        ? ws(room).submit({ path: room.repoPath, turnId, name: room.name })
        : null
      if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `候选提交失败，验收未执行：${error?.message ?? error}` })
      return
    }
    let copy
    try {
      copy = ws(room).isolatedCopy({ source: room.sourceRepo, ref: candidate ?? 'HEAD' })
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `验收隔离副本创建失败，验收未执行：${error?.message ?? error}` })
      return
    }
    const port = room.ports?.[room.workers?.[0]]
    let result
    try {
      result = await runCommand({
        command,
        cwd: copy.path,
        env: port === undefined ? undefined : { PORT: String(port) },
        sandbox: true,
      })
    } finally {
      ws(room).removeIsolatedCopy({ source: room.sourceRepo, copy })
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
    if (result.exit === 0) {
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
    if (ws(room).capabilities().merge !== true) {
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
      const result = ws(room).integrate({ path: integration, branch: branch ?? '', source })
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

    const head = ws(room).head({ path: integration })
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
    const range = await ws(room).rangeChanges({ path: integration, base })
    const command = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
    if (command === '') {
      store.appendMessage(roomId, { kind: 'system', text: `阶段 ${stageIndex + 1} 没有验收命令，未执行集成验收` })
      return
    }
    let copy
    try {
      copy = ws(room).isolatedCopy({ source: room.sourceRepo, ref: head })
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `集成验收副本创建失败，验收未执行：${error?.message ?? error}` })
      return
    }
    const port = room.ports?.integration
    let result
    try {
      result = await runCommand({
        command,
        cwd: copy.path,
        env: port === undefined ? undefined : { PORT: String(port) },
        sandbox: true,
      })
    } finally {
      ws(room).removeIsolatedCopy({ source: room.sourceRepo, copy })
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

  const startStage = async (room, index) => {
    const stage = room.stages[index]
    if (stage?.kind !== 'deliverable' && stage?.manual !== true) return
    const allWorkers = room.workers ?? []
    if (allWorkers.length === 0) throw new Error('房间没有执行席位')
    const blocked = blockedSeats(room)
    const workers = allWorkers.filter(worker => !blocked.includes(worker))
    if (blocked.length > 0) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `MCP 熔断已隔离：${blocked.map(id => room.seatNames?.[id] ?? id).join('、')} 暂停；${workers.length === 0 ? '没有可继续的执行席位，房间暂停，等你恢复。' : '其余席位继续。'}`,
      })
      const blockedUpdate = store.updateRoom(roomId, current => {
        const target = current.stages[index]
        if (target !== undefined) target.partial = { failed: [...blocked], workers: [...workers], at: Date.now() }
        if (workers.length === 0 && current.state === 'active') {
          current.state = 'paused'
          current.pauseReason = 'mcp'
        }
        return { events: [{ type: 'room.mcp_blocked', payload: { seats: blocked, stage: index } }] }
      })
      if (workers.length === 0) {
        const fresh = blockedUpdate ?? store.readRoom(roomId)
        if (fresh !== null) emit?.('room', fresh)
        return
      }
      if (blockedUpdate !== null) emit?.('room', blockedUpdate)
    }
    updateTasks(index, current => ({
      ...current,
      tasks: buildTasks({ stageIndex: index, workers, seatNames: room.seatNames ?? {} }),
    }))
    const acceptance = stage.manual === true
      ? '验收方式：人看产物，不跑命令。'
      : typeof stage.acceptance === 'string' && stage.acceptance !== ''
        ? `验收命令：\`${stage.acceptance}\`。`
        : '验收命令：未设置。'
    const promptFor = worker => {
      const port = room.ports?.[worker]
      const environment = room.workspaceEnv?.[worker]
      return [
        `@${room.seatNames?.[worker] ?? worker} 阶段已确认：${index + 1}. ${stage.title}。${acceptance}`,
        buildSeatHandoff({ room, messages: store.readMessages(roomId) }),
        workers.length > 1
          ? ws(room).capabilities().isolation === 'worktree'
            ? '你在自己的 worktree 里与其他执行席位并行工作；只改自己的 worktree，系统会把候选分支合并到房间分支。'
            : '你在自己的隔离副本里与其他执行席位并行工作；只改自己的副本，系统会按文件合并到房间目录。'
          : '在当前工作目录完成；',
        port === undefined ? '' : `如需起本地服务，用 PORT=${port}。`,
        environment?.linked?.includes('node_modules')
          ? 'node_modules 已软链为只读依赖，不要修改它。'
          : '',
        ws(room).capabilities().candidate === true
          ? '不要自己 git commit / push，系统会提交候选；完成后一句话汇报，不要 @验收，系统会自动复核。'
          : '不要改房间记录；完成后一句话汇报，不要 @验收，系统会自动复核。',
      ].join('')
    }

    if (workers.length === 1) {
      const worker = workers[0]
      markSeatRead({ store, roomId, seat: worker, emit })
      const sent = await sendToSeat(worker, promptFor(worker))
      if (sent.messageId !== null) {
        store.updateRoom(roomId, current => {
          current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
          return { events: [] }
        })
      }
      return
    }

    const startedAt = Date.now()
    const dispatch = {
      stage: index,
      workers: [...workers],
      pending: [...workers],
      failed: [],
      base: ws(room).head({ path: room.repoPath }),
      startedAt,
      integrated: false,
    }
    const stored = store.updateRoom(roomId, current => {
      current.stageDispatch = dispatch
      current.mergeConflict = null
      return { events: [{ type: 'stage.dispatch', payload: { stage: index, workers } }] }
    })
    if (stored === null) throw new Error('无法记录并行派发')
    if (stored !== null) emit?.('room', stored)
    for (const worker of workers) markSeatRead({ store, roomId, seat: worker, emit })

    const sent = await Promise.allSettled(workers.map(worker => sendToSeat(worker, promptFor(worker))))
    const failed = []
    sent.forEach((result, at) => {
      if (result.status !== 'fulfilled') {
        failed.push(workers[at])
        return
      }
      const id = result.value?.messageId
      if (id === null || id === undefined) return
      store.updateRoom(roomId, current => {
        current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), id].slice(-50)
        return { events: [] }
      })
    })
    if (failed.length > 0) {
      let ready = null
      const updated = store.updateRoom(roomId, current => {
        const currentDispatch = current.stageDispatch
        if (currentDispatch?.startedAt !== startedAt) return null
        currentDispatch.failed = [...new Set([...(currentDispatch.failed ?? []), ...failed])]
        currentDispatch.pending = currentDispatch.pending.filter(id => !failed.includes(id))
        if (currentDispatch.pending.length === 0) {
          ready = {
            stageIndex: currentDispatch.stage,
            workers: currentDispatch.workers.filter(id => !failed.includes(id)),
            base: currentDispatch.base,
          }
          if (ready.workers.length === 0) currentDispatch.stalled = true
        }
        return { events: [{ type: 'stage.dispatch_failed', payload: { stage: index, workers: failed } }] }
      })
      const names = failed.map(worker => room.seatNames?.[worker] ?? worker).join('、')
      store.appendMessage(roomId, { kind: 'system', text: `启动执行失败：${names}；其余席位继续。` })
      if (updated !== null && ready !== null) {
        if (ready.workers.length === 0) {
          store.appendMessage(roomId, { kind: 'system', text: '没有执行席位启动成功；阶段仍未进入验收。' })
        } else {
          void enqueue(() => integrateStage(ready))
        }
      }
    }

    setTimeout(() => {
      const current = store.readRoom(roomId)
      const currentDispatch = current?.stageDispatch
      if (currentDispatch?.startedAt !== startedAt) return
      if ((currentDispatch.pending ?? []).length === 0) return
      const waiting = currentDispatch.pending.map(worker => current.seatNames?.[worker] ?? worker).join('、')
      store.appendEvent(roomId, 'stage.dispatch_timeout', { stage: index, workers: currentDispatch.pending })
      store.appendMessage(roomId, { kind: 'system', text: `并行执行超时：${waiting} 还没有完成；阶段仍未进入验收。` })
      const updated = store.updateRoom(roomId, inner => {
        if (inner.stageDispatch?.startedAt !== startedAt) return null
        inner.stageDispatch.timedOut = true
        return { events: [] }
      })
      if (updated !== null) emit?.('room', updated)
    }, PARALLEL_TIMEOUT).unref()
  }

  const captureTurn = (turn, authorRef) => {
    const turnId = turn?.turnId
    if (typeof turnId !== 'string' || capturedTurns.has(turnId)) return
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
        capturedTurns.add(turnId)
        updateTasks(stageIndex, current => markTask(current, seat, 'failed'))
        store.appendMessage(roomId, {
          kind: 'system',
          text: `并行执行：${room.seatNames?.[seat] ?? seat} 这一回合没有产出；继续等其它席位。`,
        })
        const done = settleWorker(seat, turnId, true)
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
            void enqueue(() => integrateStage({ ...done, workers: remaining, turnId }))
          }
        }
      }
      return
    }
    capturedTurns.add(turnId)

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

    const pending = reviewRound?.requests.get(seat)
    if (pending !== undefined) {
      reviewRound.requests.delete(seat)
      clearTimeout(pending.timer)
      const pass = parseVerdict(turn.reply)
      const name = room?.seatNames?.[seat] ?? seat
      store.appendMessage(roomId, {
        kind: 'verdict',
        authorId: pending.verifier,
        text: turn.reply || '复核回合没有给出文字结论。',
        meta: {
          pass,
          stage: pending.stage,
          command: pending.command,
          exit: pending.exit,
          evidenceId: pending.evidenceId,
          review: true,
          blind: true,
          verifier: pending.verifier,
          turnId,
          simulated: false,
        },
      })
      store.appendEvent(roomId, 'verifier.verdict', { stage: pending.stage, verifier: pending.verifier, pass, blind: true, turnId })
      if (!pass) {
        updateTasks(pending.stage, current => markStageTasks(current, 'working'))
        for (const [remainingSeat, request] of reviewRound.requests) {
          clearTimeout(request.timer)
          store.appendEvent(roomId, 'review.cancelled', {
            stage: pending.stage,
            verifier: remainingSeat,
            reason: `${name} 已打回`,
          })
        }
        reviewRound.requests.clear()
        reviewRound = null
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${name} 打回；其余验收席位不再等待，返工后重跑验收命令。`,
        })
      } else {
        reviewRound.passed = (reviewRound.passed ?? 0) + 1
        if (reviewRound.requests.size > 0) {
          store.appendMessage(roomId, {
            kind: 'system',
            text: `${name} PASS；还有 ${reviewRound.requests.size} 个验收席位复核中。`,
          })
        } else {
          const passed = reviewRound.passed
          const total = reviewRound.total
          reviewRound = null
          if (passed === total) {
            updateTasks(pending.stage, current => markStageTasks(current, 'done'))
            store.appendMessage(roomId, { kind: 'system', text: '全部验收席位 PASS，等你签字。' })
          } else {
            store.appendMessage(roomId, {
              kind: 'system',
              text: `本轮复核结束：${passed}/${total} 个验收席位 PASS；其余未回报，不能签字。`,
            })
          }
        }
      }
      recordTurn(true)
      return
    }

    store.appendEvent(roomId, 'turn.completed', { turnId, seat: seat ?? 'unknown' })
    if (role !== 'worker') {
      recordTurn(false)
      return
    }

    const calls = turns.get(turnId) ?? []
    turns.delete(turnId)
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
      if (typeof filePath !== 'string' || !existsSync(filePath)) continue
      if (artifacts.some(item => item.path === filePath)) continue
      const content = readFileSync(filePath)
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
      void enqueue(async () => {
        const current = store.readRoom(roomId)
        if (current === null) return
        const worktree = current.worktrees?.[seat]
        let candidate = null
        if (worktree !== undefined && ws(current).capabilities().candidate === true) {
          try {
            candidate = ws(current).submit({ path: worktree, turnId, name: current.name })
            if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage, turnId, seat, commit: candidate })
          } catch (error) {
            store.appendMessage(roomId, { kind: 'system', text: `候选提交失败（${current.seatNames?.[seat] ?? seat}）：${error?.message ?? error}` })
          }
        }
        const base = dispatch?.stage === stage && typeof dispatch.base === 'string'
          ? dispatch.base
          : ws(current).head({ path: current.repoPath })
        const range = worktree === undefined
          ? { diff: '', files: [] }
          : await ws(current).rangeChanges({ path: worktree, base })
        const head = worktree === undefined ? '' : ws(current).head({ path: worktree })
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
        updateTasks(stage, stageState => markTask(stageState, seat, 'reported', stored.id))
        store.appendEvent(roomId, 'turn.evidence', { stage, turnId, seat })
        recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

        const done = settleWorker(seat, turnId, false)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            store.appendMessage(roomId, { kind: 'system', text: '并行执行：没有可合并的执行席位；阶段仍未进入验收。' })
          } else {
            await integrateStage({ ...done, workers: remaining, turnId })
          }
          return
        }
        if (pendingForSeat) return
        if (dispatch !== null && dispatch !== undefined && dispatch.stage !== stage) return
        const active = current.stages[stage]
        if (active === undefined || !isWorkStage(active) || active.state !== 'active') return
        if (reviewRound !== null && reviewRound.requests.size > 0) return
        const latest = [...store.readMessages(roomId)].reverse()
          .find(message => message.kind === 'verdict' && message.meta?.stage === stage)
        if (latest?.meta?.pass === true) return
        await integrateStage({ stageIndex: stage, workers: [seat], base: ws(current).head({ path: current.repoPath }), turnId })
      })
      return
    }

    const storedEvidence = store.appendMessage(roomId, evidence)
    if (seat !== null && seat !== undefined) {
      updateTasks(stage, stageState => markTask(stageState, seat, 'reported', storedEvidence.id))
    }
    store.appendEvent(roomId, 'turn.evidence', { stage, turnId })
    recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

    if (room !== null) {
      const target = room.stages[stage]
      const command = typeof target?.acceptance === 'string' ? target.acceptance.trim() : ''
      const key = `${stage}:${turnId}`
      if (target?.manual === true && target.state === 'active' && !acceptanceRuns.has(key)) {
        acceptanceRuns.add(key)
        try {
          if (ws(room).capabilities().candidate === true) {
            const candidate = ws(room).submit({ path: room.repoPath, turnId, name: room.name })
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
        markProgress()
      } else if (command !== '' && target?.kind === 'deliverable' && target.state === 'active' && !acceptanceRuns.has(key)) {
        acceptanceRuns.add(key)
        acceptanceChain = acceptanceChain
          .then(() => runAcceptance(stage, command, turnId))
          .catch(error => {
            store.appendMessage(roomId, { kind: 'system', text: `验收命令执行出错：${error?.message ?? error}` })
          })
      }
    }
  }

  const requestReview = async stageIndex => {
    if (reviewRound !== null) reject('conflict', '上一次复核还没有结束')
    const room = store.readRoom(roomId)
    const stage = room?.stages?.[stageIndex]
    if (stage === undefined || stage.kind !== 'deliverable') reject('invalid', '这个阶段不是交付型')
    if (stage.state !== 'active') reject('conflict', '这个阶段不在待验收状态')
    const budget = budgetStatus(room, store.readRooms())
    if (!budget.ok) reject('conflict', budget.message)

    const messages = store.readMessages(roomId)
    const outcome = reviewState({ room, messages, stageIndex })
    if (outcome.state === 'pass') reject('conflict', '本阶段全部验收席位已经有 PASS 了')
    if (outcome.state === 'reject') reject('conflict', '验收已被打回；先返工并重新跑验收命令')
    if (outcome.state === 'failed') reject('conflict', '最新验收命令没有通过；先返工并重新跑验收命令')
    const ids = verifierIds(room)
    if (ids.length === 0) reject('conflict', '房间没有验收席位')
    const evidence = outcome.evidence
    if (evidence === undefined || evidence === null) reject('conflict', '还没有本阶段的验收命令证据')
    const targets = outcome.state === 'pending' ? outcome.missing : ids
    if (targets.length === 0) reject('conflict', '所有验收席位都已回报')

    const meta = evidence.meta
    const round = {
      stage: stageIndex,
      evidenceId: evidence.id,
      command: meta.command,
      exit: meta.exit,
      total: ids.length,
      passed: outcome.verdicts.filter(message => message.meta?.pass === true).length,
      requests: new Map(),
    }
    reviewRound = round
    store.appendEvent(roomId, 'review.requested', {
      stage: stageIndex,
      evidenceId: evidence.id,
      verifiers: targets,
    })
    const failures = []
    for (const verifier of targets) {
      const verifierName = room.seatNames?.[verifier]
      if (typeof verifierName !== 'string' || verifierName === '') {
        failures.push(`${verifier}: 没有席位名字`)
        continue
      }
      if (room.worktrees?.[verifier] !== undefined && typeof room.branch === 'string') {
        try {
          ws(room).refreshReviewCopy({ path: room.worktrees[verifier], branch: room.branch, source: room.sourceRepo, from: room.repoPath })
        } catch (error) {
          failures.push(`${verifierName}: 复核副本不可用（${error?.message ?? error}）`)
          store.appendMessage(roomId, { kind: 'system', text: `复核副本不可用（${verifierName}）：${error?.message ?? error}` })
          continue
        }
      }
      const verifierPort = room.ports?.[verifier]
      const prompt = [
        `@${verifierName} 你现在是验收席位${ids.length > 1 ? `（${targets.indexOf(verifier) + 1}/${targets.length} 个本轮请求）` : ''}。只做只读复核，不改任何文件，不提交、不推送。`,
        '盲审：你只拿到目标、约束、本轮验收证据和改动，不读取执行席位的对话；判定只看证据和代码。',
        buildSeatHandoff({ room, messages }),
        `工作目录：${room.worktrees?.[verifier] ?? room.repoPath ?? '(未设置)'}`,
        ...(verifierPort === undefined ? [] : [`如需起本地服务，用 PORT=${verifierPort}。`]),
        `验收命令：${meta.command}`,
        `退出码：${meta.exit === null ? '无' : meta.exit}`,
        '命令输出：',
        '```',
        tail(meta.output, 4000),
        '```',
        '改动：',
        '```diff',
        tail(meta.diff, 6000),
        '```',
        '',
        '请自己打开改动过的文件核对；必要时自己重跑验收命令，不要把上面的输出当成唯一依据。',
        '只评审交付改动；`.crew/` 下是房间运行中的状态记录，不属于交付内容，忽略它。',
        ...(ids.length > 1 ? [`本阶段共有 ${ids.length} 个验收席位；全部 PASS 才能签字，任一 REJECT 都会退回。`] : []),
        '第一行只写 PASS 或 REJECT，说明从第二行开始。判定不清就写 REJECT。',
      ].join('\n')

      const request = {
        stage: stageIndex,
        verifier,
        command: meta.command,
        exit: meta.exit,
        evidenceId: evidence.id,
        timer: null,
      }
      round.requests.set(verifier, request)
      request.timer = setTimeout(() => {
        if (reviewRound !== round || reviewRound.requests.get(verifier) !== request) return
        reviewRound.requests.delete(verifier)
        store.appendEvent(roomId, 'review.timeout', { stage: stageIndex, verifier })
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${verifierName} 复核超时，没有收到验收结论；这一轮仍未通过。`,
        })
        if (reviewRound.requests.size === 0) {
          const passed = reviewRound.passed
          const total = reviewRound.total
          reviewRound = null
          store.appendMessage(roomId, {
            kind: 'system',
            text: `本轮复核结束：${passed}/${total} 个验收席位 PASS；其余未回报，不能签字。`,
          })
        }
      }, REVIEW_TIMEOUT).unref()
      markSeatRead({ store, roomId, seat: verifier, emit })
      try {
        const sent = await sendToSeat(verifier, prompt)
        if (sent.messageId !== null) {
          store.updateRoom(roomId, current => {
            current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
            return { events: [] }
          })
        }
      } catch (error) {
        clearTimeout(request.timer)
        round.requests.delete(verifier)
        failures.push(`${verifierName}: ${error?.message ?? error}`)
        store.appendMessage(roomId, {
          kind: 'system',
          text: `复核请求发送失败（${verifierName}）：${error?.message ?? error}`,
        })
      }
    }
    if (round.requests.size === 0) {
      reviewRound = null
      reject('conflict', `复核请求没有发出：${failures.join('；') || '没有可用验收席位'}`)
    }
    return { requested: true, stage: stageIndex, verifiers: [...round.requests.keys()] }
  }

  return {
    seed,
    trackTool,
    captureTurn,
    requestReview,
    startStage,
    busyReview: () => reviewRound !== null && reviewRound.requests.size > 0,
  }
}
