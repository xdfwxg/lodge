import { blockedSeats } from '../../mcp-breaker.js'
import { studioTransitionEvent, transitionStudio } from './state.js'
import { markSeatRead } from '../../watermarks.js'
import { seatLabelMap } from '../../seat-labels.js'
import { buildTasks } from './tasks.js'
import { activeStageReadOnly } from './turn-utils.js'
import { planDispatch } from '../../orchestration/index.js'
import { seatDisplayName } from '../../seat-labels.js'
import { workspaceOf } from './workspace.js'
import { studioWorkerPrompt } from './prompts.js'

export const createStageStarter = ({ store, roomId, emit, sendToSeat, updateTasks, integrate, enqueue, skills }) => {
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
    if (allWorkers.length === 0) throw new Error('房间没有执行席位')
    const blocked = blockedSeats(room)
    const workers = allWorkers.filter(worker => !blocked.includes(worker))
    if (blocked.length > 0) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `MCP 熔断已隔离：${blocked.map(id => seatDisplayName(room, id)).join('、')} 暂停；${workers.length === 0 ? '没有可继续的执行席位，房间暂停，等你恢复。' : '其余席位继续。'}`,
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
    const dispatchPlan = planDispatch({ room, stage, index, workers })
    const { strategy } = dispatchPlan
    // 工作室 v1 是群聊单工作目录：一次只交给一个执行席位，避免同目录并行写。
    const assignees = dispatchPlan.assignees.slice(0, 1)
    if (assignees.length === 0) throw new Error('编排策略没有可派发的执行席位')
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
      tasks: buildTasks({ stageIndex: index, workers: assignees, seatNames: seatLabelMap(room) }),
    }))
    const workerNames = assignees.map(worker => `@${seatDisplayName(room, worker)}`).join('、')
    const modeLabel = `（${strategy.name}）`
    store.appendMessage(roomId, {
      kind: 'dispatch',
      authorId: room.leadSeat ?? room.members?.[0] ?? 'planner',
      text: rework
        ? `阶段返工${modeLabel}：阶段 ${index + 1}「${stage.title}」交给 ${workerNames}。${note === '' ? '' : `用户意见：${note.slice(0, 160)}`}`
        : `阶段派活${modeLabel}：阶段 ${index + 1}「${stage.title}」交给 ${workerNames}。`,
      meta: {
        stage: index,
        workers: assignees,
        orchestration: strategy.id,
        orchestrationName: strategy.name,
        acceptance: typeof stage.acceptance === 'string' ? stage.acceptance : '',
        rework,
        ...(note === '' ? {} : { note: note.slice(0, 160) }),
      },
    })
    if (dispatchPlan.note !== '') store.appendMessage(roomId, { kind: 'system', text: dispatchPlan.note })
    const acceptance = stage.manual === true
      ? '验收方式：人看产物，不跑命令。'
      : typeof stage.acceptance === 'string' && stage.acceptance !== ''
        ? `验收命令：\`${stage.acceptance}\`。`
        : '验收命令：未设置。'
    const readOnly = activeStageReadOnly(room) || stage.readOnly === true
    const workspaceCaps = workspaceOf(room).capabilities()
    const seatSkillsOf = worker => (room.seatSpecs?.find(seat => seat.id === worker)?.skills ?? [])
      .map(id => skills?.read?.(id))
      .filter(Boolean)
    const worker = assignees[0]
    const prompt = studioWorkerPrompt({
      room,
      messages: store.readMessages(roomId),
      stage,
      index,
      assignee: worker,
      rework,
      note,
      acceptance,
      readOnly,
      seatSkills: seatSkillsOf(worker),
      workspace: {
        multi: assignees.length > 1,
        isolation: workspaceCaps.isolation,
        candidate: workspaceCaps.candidate === true,
      },
      port: room.ports?.[worker],
      environment: room.workspaceEnv?.[worker],
    })

    markSeatRead({ store, roomId, seat: worker, emit })
    await sendToSeat(worker, prompt)

  }


  return { startStage }
}
