import { studioTransitionEvent, transitionStudio } from './state.js'
import { seatLabelMap } from '../../seat-labels.js'
import { buildTasks, markTask } from './tasks.js'
import { activeStageReadOnly, PARALLEL_TIMEOUT } from './turn-utils.js'
import { planDispatch } from '../../orchestration/index.js'
import { seatDisplayName } from '../../seat-labels.js'
import { workspaceOf } from './workspace.js'
import { studioWorkerPrompt } from './prompts.js'

export const createStageStarter = ({ store, roomId, emit, handoff = null, sendToSeat = null, updateTasks, integrate, enqueue }) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt }) => sendToSeat?.(to, prompt))
  const startStage = async (room, index, { note = '', rework = false } = {}) => {
    const stage = room.stages[index]
    if (stage?.kind !== 'deliverable' && stage?.manual !== true) return
    // 验收要能判断“执行者自己 commit 了但工作树干净”的新交付；按阶段记下起始 HEAD。
    const stageBase = typeof room.repoPath === 'string' && room.repoPath !== '' && typeof workspaceOf(room).head === 'function'
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    if (typeof stageBase === 'string' && stageBase !== '') {
      store.updateRoom(roomId, current => {
        current.stageBases = { ...(current.stageBases ?? {}), [index]: stageBase }
        return { events: [] }
      })
    }
    const allWorkers = room.workers ?? []
    if (allWorkers.length === 0) throw new Error('房间没有执行成员')
    const workers = allWorkers
    const dispatchPlan = planDispatch({ room, stage, index, workers })
    let assignees = dispatchPlan.assignees
    if (assignees.length === 0) throw new Error('编排策略没有可派发的执行成员')
    const workspaceCaps = workspaceOf(room).capabilities()
    if (assignees.length > 1 && workspaceCaps.merge !== true) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `这个安排方式要求 ${assignees.length} 位执行成员同时开工；这个文件夹不能合并改动，先交给 ${seatDisplayName(room, assignees[0])}。`,
      })
      assignees = assignees.slice(0, 1)
    }
    const parallel = assignees.length > 1
    {
      const updated = store.updateRoom(roomId, current => {
        const moved = transitionStudio(current.closure ?? 'open', 'start_execute', { hasPlan: current.plan !== null && current.plan !== undefined })
        if (!moved.ok) return null
        current.closure = moved.state
        return { events: [studioTransitionEvent(moved, 'start_execute', 'planner', {}, '阶段开始')] }
      })
      if (updated !== null) emit?.('room', updated)
    }
    updateTasks(index, current => ({
      ...current,
      tasks: buildTasks({ stageIndex: index, workers: assignees, seatLabels: seatLabelMap(room) }),
    }))
    if (dispatchPlan.note !== '') store.appendMessage(roomId, { kind: 'system', text: dispatchPlan.note })
    const acceptance = stage.manual === true
      ? '验收方式：人看结果，不跑命令。'
      : typeof stage.acceptance === 'string' && stage.acceptance !== ''
        ? `验收命令：\`${stage.acceptance}\`。`
        : '验收命令：未设置。'
    const readOnly = activeStageReadOnly(room) || stage.readOnly === true
    const promptFor = worker => studioWorkerPrompt({
      room,
      messages: store.readMessages(roomId),
      stage,
      index,
      assignee: worker,
      rework,
      note,
      acceptance,
      readOnly,
      workspace: {
        candidate: workspaceCaps.candidate === true,
        parallel,
        isolation: workspaceCaps.isolation,
      },
      port: room.ports?.[worker],
      environment: room.workspaceEnv?.[worker],
    })
    const from = room.leadSeat ?? room.members?.[0] ?? 'you'

    if (!parallel) {
      const worker = assignees[0]
      await handoffTrigger({
        room,
        stage,
        index,
        from,
        to: worker,
        reason: rework ? 'rework' : 'dispatch',
        prompt: promptFor(worker),
        acceptance: typeof stage.acceptance === 'string' ? stage.acceptance : '',
        rework,
      })
      return
    }

    const startedAt = Date.now()
    const dispatch = {
      stage: index,
      workers: [...assignees],
      pending: [...assignees],
      failed: [],
      base: stageBase,
      startedAt,
      integrated: false,
    }
    const stored = store.updateRoom(roomId, current => {
      current.stageDispatch = dispatch
      current.mergeConflict = null
      return { events: [{ type: 'stage.dispatch', payload: { stage: index, workers: assignees, orchestration: dispatchPlan.strategy.id } }] }
    })
    if (stored === null) throw new Error('无法记录并行派发')
    emit?.('room', stored)

    const settled = await Promise.allSettled(assignees.map(worker => handoffTrigger({
      room,
      stage,
      index,
      from,
      to: worker,
      reason: rework ? 'rework' : 'dispatch',
      prompt: promptFor(worker),
      acceptance: typeof stage.acceptance === 'string' ? stage.acceptance : '',
      rework,
    })))
    const failed = settled
      .map((result, at) => (result.status === 'rejected' ? assignees[at] : null))
      .filter(Boolean)
    if (failed.length > 0) {
      let ready = null
      const updated = store.updateRoom(roomId, current => {
        const currentDispatch = current.stageDispatch
        if (currentDispatch?.startedAt !== startedAt) return null
        currentDispatch.failed = [...new Set([...(currentDispatch.failed ?? []), ...failed])]
        currentDispatch.pending = currentDispatch.pending.filter(id => !failed.includes(id))
        if (currentDispatch.pending.length === 0) {
          const remaining = currentDispatch.workers.filter(id => !failed.includes(id))
          if (remaining.length === 0) currentDispatch.stalled = true
          ready = { stageIndex: currentDispatch.stage, workers: remaining, base: currentDispatch.base }
        }
        return { events: [{ type: 'stage.dispatch_failed', payload: { stage: index, workers: failed } }] }
      })
      updateTasks(index, current => failed.reduce((stageState, seat) => markTask(stageState, seat, 'failed'), current))
      store.appendMessage(roomId, {
        kind: 'system',
        text: `启动执行失败：${failed.map(worker => seatDisplayName(room, worker)).join('、')}；其余成员继续。`,
      })
      if (updated !== null && ready !== null) {
        if (ready.workers.length === 0) {
          store.appendMessage(roomId, { kind: 'system', text: '没有执行成员启动成功；这一步还没有进入验收。' })
        } else {
          void enqueue(() => integrate({ ...ready, turnId: '' }))
        }
      }
    }

    setTimeout(() => {
      const current = store.readRoom(roomId)
      const currentDispatch = current?.stageDispatch
      if (currentDispatch?.startedAt !== startedAt) return
      if ((currentDispatch.pending ?? []).length === 0) return
      const waiting = currentDispatch.pending.map(worker => seatDisplayName(current, worker)).join('、')
      store.appendEvent(roomId, 'stage.dispatch_timeout', { stage: index, workers: currentDispatch.pending })
      store.appendMessage(roomId, { kind: 'system', text: `并行执行超时：${waiting} 还没有完成；这一步还没有进入验收。` })
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
