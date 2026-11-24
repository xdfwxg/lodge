import { leadMemberOf, workerIds } from '../../room-members.js'
import { ASSIGNMENT_STATUS, ROOM_STATE, STAGE_STATE } from '../../../../shared/states.js'
import { activeDispatchAssignments, latestDispatchAssignment, transitionAssignment } from '../../assignments.js'
import { dispatchOf } from '../../assignment-projections.js'
import { activeStageReadOnly, PARALLEL_TIMEOUT } from './turn-utils.js'
import { planDispatch } from '../../orchestration/index.js'
import { memberDisplayName } from '../../member-labels.js'
import { workspaceOf } from './workspace.js'
import { studioWorkerPrompt } from './prompts.js'
import { systemNotice } from '../../notices.js'
import { appendHandoffProjection } from './projection.js'
import { historyBriefOf } from './history-brief.js'
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'
import { humanLabelOf } from '../../human-name.js'
import { usageBudgetExceeded } from '../../../../shared/usage.js'
import { beginWriteGuard } from '../../workspace-guard.js'

// 重做的“这一拍”由最近一条重做消息标识；同一拍重放幂等，新一拍必须重新派发。
const reworkBeatOf = (store, roomId, stageIndex) => {
  const messages = store.readMessages(roomId)
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at]
    if (message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex && typeof message.id === 'string') {
      return message.id
    }
  }
  return ''
}

export const createStageStarter = ({ store, roomId, emit, handoff = null, sendToMember = null, askPlanner = null, integrate, enqueue, timeoutMs = PARALLEL_TIMEOUT }) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt }) => sendToMember?.(to, prompt))
  const timeoutTimers = new Map()

  const deadlineIdOf = stageIndex => {
    const room = store.readRoom(roomId)
    return `stage-deadline:${roomId}:${room?.workRound?.id ?? 'none'}:${stageIndex}`
  }

  // 阶段级收口：成员级租约和阶段截止共用这一段，避免两套“停下以后怎么办”。
  const settleTimedOutStage = (stageIndex, dispatch, { source = 'stage' } = {}) => {
    store.cancelWork?.(deadlineIdOf(stageIndex))
    const room = store.readRoom(roomId)
    if (room === null) return false
    const pending = dispatch?.pending ?? []
    const completed = (dispatch?.workers ?? []).filter(worker => !pending.includes(worker))
    const waiting = pending.map(worker => memberDisplayName(room, worker)).join('、')
    store.appendEvent(roomId, 'stage.dispatch_timeout', { stage: stageIndex, workers: pending, source })
    store.appendMessage(roomId, {
      kind: 'system',
      text: completed.length > 0
        ? `执行超时：${waiting} 已停下；已完成的部分继续合并。`
        : `执行超时：${waiting} 已停下；这一步请退回重做。`,
    })
    const updated = store.updateRound(roomId, current => {
      current.blocked = {
        stage: stageIndex,
        reason: 'timeout',
        source,
        workers: pending,
        at: Date.now(),
      }
      return { events: [{ type: 'stage.blocked', payload: { stage: stageIndex, reason: 'timeout', source, workers: pending } }] }
    })
    if (updated !== null) emit?.('room', updated)
    if (completed.length > 0) {
      void enqueue(() => integrate({
        stageIndex,
        workers: completed,
        base: dispatch?.base,
        failed: pending,
        turnId: '',
      }))
    }
    return true
  }

  const timeoutStage = stageIndex => {
    timeoutTimers.delete(stageIndex)
    const dispatch = dispatchOf(store, roomId, stageIndex)
    if (dispatch === null || dispatch.pending.length === 0) return false
    const room = store.readRoom(roomId)
    if (room === null || room.stages?.[stageIndex]?.state !== STAGE_STATE.active) return false
    for (const assignment of activeDispatchAssignments(store, roomId, stageIndex)) {
      if (!dispatch.pending.includes(assignment.toMemberId)) continue
      transitionAssignment(store, assignment.id, 'failed', {
        resultText: '执行超时，已停止。',
        flags: { ...(assignment.flags ?? {}), timedOut: true },
      })
    }
    return settleTimedOutStage(stageIndex, dispatch, { source: 'stage' })
  }

  // 单个成员到期：只停这一位；还有别人在跑就继续等，最后一位停下才收口。
  const expireAssignment = assignmentId => {
    const assignment = store.readAssignment(assignmentId)
    if (assignment === null || !['sent', 'working'].includes(assignment.status)) return false
    const room = store.readRoom(roomId)
    if (room === null || room.state !== ROOM_STATE.active || room.stages?.[assignment.stageIndex]?.state !== STAGE_STATE.active) return false
    const before = dispatchOf(store, roomId, assignment.stageIndex)
    if (before === null || !before.pending.includes(assignment.toMemberId)) return false
    transitionAssignment(store, assignment.id, 'failed', {
      resultText: '长时间没有进展，已停止。',
      flags: { ...(assignment.flags ?? {}), timedOut: true, leaseExpired: true },
    })
    store.appendEvent(roomId, 'assignment.timed_out', {
      stage: assignment.stageIndex,
      assignmentId: assignment.id,
      memberId: assignment.toMemberId,
    })
    store.appendMessage(roomId, {
      kind: 'system',
      text: `${memberDisplayName(room, assignment.toMemberId)} 长时间没有进展，已停下。`,
    })
    const after = dispatchOf(store, roomId, assignment.stageIndex)
    if (after !== null && after.pending.length > 0) {
      watchStageTimeout(assignment.stageIndex)
      return true
    }
    // 用失败前的投影收口：completed 只算已交回的成员，已停下的不混进合并。
    return settleTimedOutStage(assignment.stageIndex, before, { source: 'lease' })
  }

  const watchStageTimeout = stageIndex => {
    const dispatch = dispatchOf(store, roomId, stageIndex)
    if (dispatch === null || dispatch.pending.length === 0) return false
    const prior = timeoutTimers.get(stageIndex)
    if (prior !== undefined) clearTimeout(prior)
    const timer = setTimeout(() => timeoutStage(stageIndex), timeoutMs)
    timer.unref?.()
    timeoutTimers.set(stageIndex, timer)
    // 内存计时器只负责准时；落一条截止时间，进程重启后仍由持久队列接上。
    store.enqueueWork?.({
      id: deadlineIdOf(stageIndex),
      roomId,
      roundId: store.readRoom(roomId)?.workRound?.id ?? null,
      kind: 'stage.deadline',
      payload: { stage: stageIndex },
      availableAt: Date.now() + timeoutMs,
    })
    return true
  }

  const dispose = () => {
    for (const stageIndex of timeoutTimers.keys()) store.cancelWork?.(deadlineIdOf(stageIndex))
    for (const timer of timeoutTimers.values()) clearTimeout(timer)
    timeoutTimers.clear()
  }
  const startStage = async (room, index, { note = '', rework = false, only = null } = {}) => {
    const stage = room.stages[index]
    if (stage?.kind !== 'deliverable' && stage?.manual !== true) return
    if (usageBudgetExceeded(room)) {
      store.appendMessage(roomId, { kind: 'system', text: '这一轮的额度用完了；先停下，等你决定要不要继续。' })
      store.appendEvent(roomId, 'round.budget_exceeded', { stage: index })
      const paused = store.updateRound(roomId, current => {
        current.state = ROOM_STATE.paused
        current.pauseReason = 'budget'
        current.idle = false
        return { events: [{ type: 'room.paused', payload: { reason: 'budget' } }] }
      })
      if (paused !== null) emit?.('room', paused)
      return
    }
    // 开工前给每棵树拍一张底：这一阶段里别人的树不该被当前说话的人改动。
    beginWriteGuard(room)
    // 验收要能判断“执行者自己 commit 了但工作树干净”的新交付；按阶段记下起始 HEAD。
    // 重做时沿用第一次记下的起点，不能被上一轮被退回的结果顶掉。
    const storedBase = typeof room.stageBases?.[index] === 'string' ? room.stageBases[index] : ''
    const stageBase = storedBase !== ''
      ? storedBase
      : (typeof room.repoPath === 'string' && room.repoPath !== '' && typeof workspaceOf(room).head === 'function'
        ? workspaceOf(room).head({ path: room.repoPath })
        : null)
    if (
      (typeof stageBase === 'string' && stageBase !== '') ||
      room.blocked?.stage === index ||
      room.mergeConflict?.stage === index
    ) {
      store.updateRound(roomId, current => {
        if (typeof stageBase === 'string' && stageBase !== '' && storedBase === '') {
          current.stageBases = { ...(current.stageBases ?? {}), [index]: stageBase }
        }
        if (current.blocked?.stage === index) current.blocked = null
        // 重做会把冲突现场一起丢掉；旧冲突和旧的“人已解决”标记不能拦住新一轮的合并。
        if (current.mergeConflict?.stage === index) current.mergeConflict = null
        if (current.mergeResolved?.stage === index) current.mergeResolved = null
        return { events: [] }
      })
    }
    const allWorkers = workerIds(room)
    if (allWorkers.length === 0) {
      // 启动态只有规划师；等组队工具把成员开出来再派活，不把房间打崩。
      store.appendMessage(roomId, { kind: 'system', text: '这一步还没有执行官；等规划师组队后再开始。' })
      return
    }
    const workers = allWorkers
    const dispatchPlan = planDispatch({ room, stage, index, workers })
    let assignees = dispatchPlan.assignees
    if (Array.isArray(only) && only.length > 0) {
      // 重试一个分支时，同一阶段被取消的兄弟分支一起复活；否则这一步永远凑不齐。
      const cancelled = new Set(
        activeDispatchAssignments(store, roomId, index)
          .filter(item => item.status === ASSIGNMENT_STATUS.cancelled)
          .map(item => item.toMemberId),
      )
      assignees = assignees.filter(id => only.includes(id) || cancelled.has(id))
    }
    if (assignees.length === 0) throw new Error('这次分配没有可执行的成员')
    const parentAssignment = rework ? latestDispatchAssignment(store, roomId, index) : null
    const reworkBeat = rework ? reworkBeatOf(store, roomId, index) : ''
    const workspaceCaps = workspaceOf(room).capabilities()
    if (assignees.length > 1 && workspaceCaps.merge !== true) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `这个安排方式要求 ${assignees.length} 位执行官同时开工；这个文件夹不能合并改动，先交给 ${memberDisplayName(room, assignees[0])}。`,
      })
      assignees = assignees.slice(0, 1)
    }
    const parallel = assignees.length > 1
    const packages = Array.isArray(stage.packages) ? stage.packages : []
    const packageFor = worker => {
      if (packages.length === 0) return null
      if (assignees.length > 1) return packages[assignees.indexOf(worker)] ?? null
      return packages.length === 1 ? packages[0] : packages
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
      memberId: worker,
      stage,
      workPackage: packageFor(worker),
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
    // 正常派活不再叫规划师重复说话：计划已经说了做什么。只有重做需要规划师补一句决定。
    if (typeof askPlanner === 'function' && rework) {
      const assigneeNames = assignees.map(id => memberDisplayName(room, id)).join('、')
      const history = historyBriefOf({ store, room, query: stage?.title ?? room.goal, before: Date.now() })
      if (history.messageIds.length > 0) {
        store.appendEvent(roomId, 'history.brief', { stage: index, messageIds: history.messageIds })
      }
      const planPrompt = [
        `第 ${index + 1} 步「${sanitizeUntrusted(stage.title, 120)}」要交给${assigneeNames}。`,
        `房间目标（原文，不要改写）：${sanitizeUntrusted(room.goal, 2000)}`,
        `验收标准：${stage.manual === true ? '人看结果，没有命令。' : sanitizeUntrusted(acceptance, 500)}`,
        rework && note !== '' ? `${humanLabelOf()}补充（原文，必须保留）：${sanitizeUntrusted(note, 2000)}` : '',
        parallel
          ? '在群里只用一句话说清这步怎么做；不要复述对齐内容或验收标准；说清交给每位执行官（写名字，不带 @）和一句动作；系统会把完整任务分别送进他们各自的工作副本。'
          : '在群里只用一句话说清这步怎么做；不要复述对齐内容或验收标准；说清交给执行官（写名字，不带 @）和一句动作；系统会把完整任务送进执行官手里。',
        '派发时保留目标里的硬要求：文件名、路径、内容、行数、格式和范围；不要改写成更宽松的说法。',
        '不要写自己的名字，不要分点、小标题或第二段。',
        history.text,
      ].filter(Boolean).join('\n')
      try {
        await askPlanner(planPrompt)
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
        acceptance: typeof stage.acceptance === 'string' ? stage.acceptance : '',
        rework,
        parentAssignmentId: parentAssignment?.id ?? null,
        nonce: reworkBeat,
      })
      appendHandoffProjection({
        store,
        roomId,
        room,
        from,
        targets: [worker],
        message: to => `@${to.map(id => memberDisplayName(room, id)).join('、@')} 第 ${index + 1} 步「${sanitizeUntrusted(stage.title, 120)}」交给你。`,
        meta: {
          stage: index,
          reason: rework ? 'rework' : 'dispatch',
          dedupeKey: `dispatch:${room.activeRoundId ?? room.workRound?.id ?? ''}:${index}:${worker}:${reworkBeat || 'dispatch'}`,
        },
      })
      watchStageTimeout(index)
      return
    }

    const startedAt = Date.now()
    store.updateRound(roomId, current => {
      current.mergeConflict = null
      return { events: [{ type: 'stage.dispatch', payload: { stage: index, workers: assignees, orchestration: dispatchPlan.strategy.id } }] }
    })

    // 重做回到这一步的起点：房间的集成分支也退回去，上一轮被退回的合并不能留在交付里。
    if (rework && typeof stageBase === 'string' && stageBase !== '' && workspaceCaps.isolation === 'worktree' &&
      typeof room.repoPath === 'string' && room.repoPath !== '') {
      try {
        workspaceOf(room).resetMemberWorktree?.({ path: room.repoPath, ref: stageBase, source: room.sourceRepo })
      } catch (error) {
        systemNotice({ store, roomId, text: '房间的集成分支没能退回这一步的起点；待处理。', error })
      }
    }

    // 每个成员从这一阶段的起点开始；重做时不能带着上一轮被退回的改动。
    if (typeof stageBase === 'string' && stageBase !== '') {
      for (const worker of assignees) {
        const path = room.worktrees?.[worker]
        if (typeof path !== 'string' || path === '') continue
        try {
          workspaceOf(room).resetMemberWorktree?.({ path, ref: stageBase, source: room.sourceRepo })
        } catch (error) {
          systemNotice({ store, roomId, text: `${memberDisplayName(room, worker)} 的工作副本没能对齐；待处理。`, error })
        }
      }
    }

    // 并行派发逐个送进成员自己的工作副本；群里的 @ 只是投影，不能靠它唤醒，
    // 否则基座会让所有成员在同一个房间目录里干活，后写的直接覆盖先写的。
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
      parentAssignmentId: parentAssignment?.id ?? null,
      nonce: reworkBeat,
      context: { base: stageBase, parallel: true },
      privateRoom: true,
    })))
    // 只 @ 真正收到任务的人：先送，再投影。
    const delivered = assignees.filter((worker, at) => settled[at].status === 'fulfilled')
    if (delivered.length > 0) {
      appendHandoffProjection({
        store,
        roomId,
        room,
        from,
        targets: delivered,
        message: to => {
          const names = to.map(worker => memberDisplayName(room, worker)).join('、@')
          return to.length > 1
            ? `@${names} 第 ${index + 1} 步「${sanitizeUntrusted(stage.title, 120)}」交给你们，各自在自己的副本里完成。`
            : `@${names} 第 ${index + 1} 步「${sanitizeUntrusted(stage.title, 120)}」交给你。`
        },
        meta: {
          stage: index,
          reason: rework ? 'rework' : 'dispatch',
          dedupeKey: `dispatch:${room.activeRoundId ?? room.workRound?.id ?? ''}:${index}:${delivered.join(',')}:${reworkBeat || 'dispatch'}`,
        },
      })
    }
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
          store.appendMessage(roomId, { kind: 'system', text: '这一步没有成员能开工；待处理。' })
        } else {
          void enqueue(() => integrate({ stageIndex: index, workers: remaining, base: dispatch.base, failed, turnId: '' }))
        }
      }
    }

    watchStageTimeout(index)
  }

  return { startStage, watchStageTimeout, timeoutStage, expireAssignment, dispose }
}
