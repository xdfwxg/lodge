import { studioTransitionEvent, transitionStudio } from './state.js'
import { leadMemberOf, workerIds } from '../../room-members.js'
import { activeDispatchAssignments, latestDispatchAssignment, transitionAssignment } from '../../assignments.js'
import { dispatchOf } from '../../assignment-projections.js'
import { activeStageReadOnly, PARALLEL_TIMEOUT } from './turn-utils.js'
import { planDispatch } from '../../orchestration/index.js'
import { memberDisplayName } from '../../member-labels.js'
import { workspaceOf } from './workspace.js'
import { studioWorkerPrompt } from './prompts.js'
import { systemNotice } from '../../notices.js'

export const createStageStarter = ({ store, roomId, emit, handoff = null, sendToMember = null, askPlanner = null, integrate, enqueue, timeoutMs = PARALLEL_TIMEOUT }) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt }) => sendToMember?.(to, prompt))
  const timeoutTimers = new Map()

  const timeoutStage = stageIndex => {
    timeoutTimers.delete(stageIndex)
    const dispatch = dispatchOf(store, roomId, stageIndex)
    if (dispatch === null || dispatch.pending.length === 0) return
    const room = store.readRoom(roomId)
    if (room === null || room.stages?.[stageIndex]?.state !== 'active') return
    const completed = dispatch.workers.filter(worker => !dispatch.pending.includes(worker))
    const waiting = dispatch.pending.map(worker => memberDisplayName(room, worker)).join('、')
    for (const assignment of activeDispatchAssignments(store, roomId, stageIndex)) {
      if (!dispatch.pending.includes(assignment.toMemberId)) continue
      transitionAssignment(store, assignment.id, 'failed', {
        resultText: '执行超时，已停止。',
        flags: { ...(assignment.flags ?? {}), timedOut: true },
      })
    }
    store.appendEvent(roomId, 'stage.dispatch_timeout', { stage: stageIndex, workers: dispatch.pending })
    store.appendMessage(roomId, {
      kind: 'system',
      text: completed.length > 0
        ? `执行超时：${waiting} 已停下；已完成的部分继续合并。`
        : `执行超时：${waiting} 已停下；这一步需要你退回重做。`,
    })
    const updated = store.updateRoom(roomId, current => {
      current.blocked = {
        stage: stageIndex,
        reason: 'timeout',
        workers: dispatch.pending,
        at: Date.now(),
      }
      return { events: [{ type: 'stage.blocked', payload: { stage: stageIndex, reason: 'timeout', workers: dispatch.pending } }] }
    })
    if (updated !== null) emit?.('room', updated)
    if (completed.length > 0) {
      void enqueue(() => integrate({
        stageIndex,
        workers: completed,
        base: dispatch.base,
        failed: dispatch.pending,
        turnId: '',
      }))
    }
  }

  const watchStageTimeout = stageIndex => {
    const dispatch = dispatchOf(store, roomId, stageIndex)
    if (dispatch === null || dispatch.pending.length === 0) return false
    const prior = timeoutTimers.get(stageIndex)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => timeoutStage(stageIndex), timeoutMs)
    timer.unref?.()
    timeoutTimers.set(stageIndex, timer)
    return true
  }
  const startStage = async (room, index, { note = '', rework = false, only = null } = {}) => {
    const stage = room.stages[index]
    if (stage?.kind !== 'deliverable' && stage?.manual !== true) return
    // 验收要能判断“执行者自己 commit 了但工作树干净”的新交付；按阶段记下起始 HEAD。
    const stageBase = typeof room.repoPath === 'string' && room.repoPath !== '' && typeof workspaceOf(room).head === 'function'
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    if (typeof stageBase === 'string' && stageBase !== '') {
      store.updateRoom(roomId, current => {
        current.stageBases = { ...(current.stageBases ?? {}), [index]: stageBase }
        if (current.blocked?.stage === index) current.blocked = null
        return { events: [] }
      })
    }
    const allWorkers = workerIds(room)
    if (allWorkers.length === 0) throw new Error('房间没有执行成员')
    const workers = allWorkers
    const dispatchPlan = planDispatch({ room, stage, index, workers })
    let assignees = dispatchPlan.assignees
    if (Array.isArray(only) && only.length > 0) assignees = assignees.filter(id => only.includes(id))
    if (assignees.length === 0) throw new Error('编排策略没有可派发的执行成员')
    const parentAssignment = rework ? latestDispatchAssignment(store, roomId, index) : null
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
    // 交接这句话由规划师自己说。它不 @ 人，系统只把它的话和任务一起转给执行成员。
    let spoken = ''
    if (typeof askPlanner === 'function') {
      const assigneeNames = assignees.map(id => memberDisplayName(room, id)).join('、')
      const planPrompt = [
        `第 ${index + 1} 步「${stage.title}」要交给${assigneeNames}。`,
        `在话里 @${assigneeNames}，让对方收到；用一两句说清做什么、怎么算完成。`,
        '不要写自己的名字，不要分点或小标题。',
        acceptance,
      ].filter(Boolean).join('\n')
      try {
        spoken = await askPlanner(planPrompt)
      } catch (error) {
        systemNotice({ store, roomId, text: '规划师没有开口，这一步还没开始。', error })
        return
      }
    }

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
        message: spoken,
        visible: spoken === '',
        deliver: spoken === '',
        acceptance: typeof stage.acceptance === 'string' ? stage.acceptance : '',
        rework,
        parentAssignmentId: parentAssignment?.id ?? null,
      })
      watchStageTimeout(index)
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
      message: spoken,
      visible: spoken === '',
      deliver: spoken === '',
      acceptance: typeof stage.acceptance === 'string' ? stage.acceptance : '',
      rework,
      parentAssignmentId: parentAssignment?.id ?? null,
      context: { base: stageBase, parallel: true },
    })))
    const failed = settled
      .map((result, at) => (result.status === 'rejected' ? assignees[at] : null))
      .filter(Boolean)
    if (failed.length > 0) {
      store.appendEvent(roomId, 'stage.dispatch_failed', { stage: index, workers: failed })
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${failed.map(worker => memberDisplayName(room, worker)).join('、')} 没能开工；其余成员继续。`,
      })
      const dispatch = dispatchOf(store, roomId, index)
      if (dispatch !== null && dispatch.pending.length === 0) {
        const remaining = dispatch.workers.filter(id => !failed.includes(id))
        if (remaining.length === 0) {
          store.appendMessage(roomId, { kind: 'system', text: '这一步没有成员能开工；需要你处理。' })
        } else {
          void enqueue(() => integrate({ stageIndex: index, workers: remaining, base: dispatch.base, failed, turnId: '' }))
        }
      }
    }

    watchStageTimeout(index)
  }

  return { startStage, watchStageTimeout }
}
