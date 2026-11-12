import { blockedSeats } from './mcp-breaker.js'
import { markSeatRead } from './watermarks.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { buildTasks } from './tasks.js'
import { PARALLEL_TIMEOUT } from './live-turn-utils.js'
import { workspaceOf } from './live-workspace.js'

export const createStageStarter = ({ store, roomId, emit, sendToSeat, updateTasks, integrate, enqueue }) => {
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
          ? workspaceOf(room).capabilities().isolation === 'worktree'
            ? '你在自己的 worktree 里与其他执行席位并行工作；只改自己的 worktree，系统会把候选分支合并到房间分支。'
            : '你在自己的隔离副本里与其他执行席位并行工作；只改自己的副本，系统会按文件合并到房间目录。'
          : '在当前工作目录完成；',
        port === undefined ? '' : `如需起本地服务，用 PORT=${port}。`,
        environment?.linked?.includes('node_modules')
          ? 'node_modules 已软链为只读依赖，不要修改它。'
          : '',
        workspaceOf(room).capabilities().candidate === true
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
      base: workspaceOf(room).head({ path: room.repoPath }),
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
          void enqueue(() => integrate(ready))
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

  return { startStage }
}
