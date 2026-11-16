import { studioTransitionEvent, transitionStudio } from './state.js'
import { leadMemberOf, workerIds } from '../../room-members.js'
import { activeDispatchAssignments, dispatchOf, updateAssignment } from '../../assignments.js'
import { activeStageReadOnly, PARALLEL_TIMEOUT } from './turn-utils.js'
import { planDispatch } from '../../orchestration/index.js'
import { memberDisplayName } from '../../member-labels.js'
import { workspaceOf } from './workspace.js'
import { studioWorkerPrompt } from './prompts.js'

export const createStageStarter = ({ store, roomId, emit, handoff = null, sendToMember = null, integrate, enqueue }) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt }) => sendToMember?.(to, prompt))
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
    const allWorkers = workerIds(room)
    if (allWorkers.length === 0) throw new Error('房间没有执行成员')
    const workers = allWorkers
    const dispatchPlan = planDispatch({ room, stage, index, workers })
    let assignees = dispatchPlan.assignees
    if (assignees.length === 0) throw new Error('编排策略没有可派发的执行成员')
    const workspaceCaps = workspaceOf(room).capabilities()
    if (assignees.length > 1 && workspaceCaps.merge !== true) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `这个安排方式要求 ${assignees.length} 位执行成员同时开工；这个文件夹不能合并改动，先交给 ${memberDisplayName(room, assignees[0])}。`,
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
    const from = leadMemberOf(room)?.id ?? 'you'

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
    store.updateRoom(roomId, current => {
      current.mergeConflict = null
      return { events: [{ type: 'stage.dispatch', payload: { stage: index, workers: assignees, orchestration: dispatchPlan.strategy.id } }] }
    })

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
      context: { base: stageBase, parallel: true },
    })))
    const failed = settled
      .map((result, at) => (result.status === 'rejected' ? assignees[at] : null))
      .filter(Boolean)
    if (failed.length > 0) {
      store.appendEvent(roomId, 'stage.dispatch_failed', { stage: index, workers: failed })
      store.appendMessage(roomId, {
        kind: 'system',
        text: `启动执行失败：${failed.map(worker => memberDisplayName(room, worker)).join('、')}；其余成员继续。`,
      })
      const dispatch = dispatchOf(store, roomId, index)
      if (dispatch !== null && dispatch.pending.length === 0) {
        const remaining = dispatch.workers.filter(id => !failed.includes(id))
        if (remaining.length === 0) {
          store.appendMessage(roomId, { kind: 'system', text: '没有执行成员启动成功；这一步还没有进入验收。' })
        } else {
          void enqueue(() => integrate({ stageIndex: index, workers: remaining, base: dispatch.base, failed, turnId: '' }))
        }
      }
    }

    setTimeout(() => {
      const dispatch = dispatchOf(store, roomId, index)
      if (dispatch === null || dispatch.pending.length === 0) return
      const waiting = dispatch.pending.map(worker => memberDisplayName(store.readRoom(roomId) ?? room, worker)).join('、')
      store.appendEvent(roomId, 'stage.dispatch_timeout', { stage: index, workers: dispatch.pending })
      store.appendMessage(roomId, { kind: 'system', text: `并行执行超时：${waiting} 还没有完成；这一步还没有进入验收。` })
      for (const assignment of activeDispatchAssignments(store, roomId, index)) {
        if (!dispatch.pending.includes(assignment.toMemberId)) continue
        updateAssignment(store, assignment.id, { flags: { ...(assignment.flags ?? {}), timedOut: true } })
      }
      emit?.('room', store.readRoom(roomId) ?? room)
    }, PARALLEL_TIMEOUT).unref()
  }

  return { startStage }
}
