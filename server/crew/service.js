import { budgetHint, budgetStatus } from './budget.js'
import { simulateRoom } from './demo.js'
import { createDispatchService } from './dispatch-service.js'
import { evaluateRoomGate } from './room-gate.js'
import { createRealRoom } from './room-create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './room-complete.js'
import { createServiceDelivery } from './service-delivery.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceRunControl } from './service-run-control.js'
import { createServiceChat } from './service-chat.js'
import { createServiceClosure } from './service-closure.js'
import { createServiceSeats } from './service-seats.js'
import { createServiceStages } from './service-stages.js'
import { createServiceSubrooms } from './service-subrooms.js'
import { createServiceTrust } from './service-trust.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, dispatchPayload, seats, ports }) => {
  const { readRoom, readRooms, readMessages, writeRoom, appendMessage } = store
  const { roomFiles, workspace, project, usage, handoff, files } = ports
  const dispatch = createDispatchService({ store, emit, dispatchPayload })

  const queries = createServiceQueries({
    store,
    engine,
    seats,
    dispatchPayload,
    roomFiles,
    project,
    usage,
    files,
    workspace,
  })
  const delivery = createServiceDelivery({
    store,
    handoff,
    workspaceRoot: workspace.root(),
  })
  const seatActions = createServiceSeats({ store, engine, live, emit, roomFiles, workspace })
  const completeRoom = createRoomCompleter({ store, emit, roomFiles, workspace }).completeRoom
  const stages = createServiceStages({ store, live, emit, dispatchPayload, completeRoom, roomFiles, plannerMcp: ports.plannerMcp })
  const chat = createServiceChat({ store, live, emit, dispatchPayload })
  const closure = createServiceClosure({ store, emit, dispatchPayload, plannerMcp: ports.plannerMcp })
  const runControl = createServiceRunControl({ store, live, emit, dispatchPayload, roomFiles })
  const trust = createServiceTrust({ store, emit, dispatchPayload })

  const createRoomWithParent = (body, parentRoom = null) => createRealRoom({
    store,
    engine,
    live,
    emit,
    seats,
    dispatchPayload,
    body,
    ports,
    parentRoom,
  })
  const createRoom = body => createRoomWithParent(body)
  const subrooms = createServiceSubrooms({ createRoom: createRoomWithParent })

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')

    if ((action === 'pause' || action === 'resume' || action === 'stop') && method === 'POST') {
      return runControl.control(room, action)
    }

    if (action === 'seats' && method === 'POST') {
      return seatActions.addSeat(room, await readBody())
    }

    if (action === 'stages' && method === 'POST') {
      return stages.editStagePlan(room, await readBody())
    }

    if (action === 'trust' && method === 'POST') {
      return trust.setTrust(room, await readBody())
    }

    if (action === 'approvals' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间有基座权限卡')
      if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
      const body = await readBody()
      const approvalId = typeof body.id === 'string' ? body.id : ''
      const decision = body.decision === 'allow' ? 'allow' : body.decision === 'deny' ? 'deny' : ''
      if (approvalId === '') return fail('invalid', '缺少审批 id')
      if (decision === '') return fail('invalid', '审批只接受 allow/deny')
      const result = await live.decideApproval(room.id, approvalId, decision)
      if (result.ok !== true) return fail('conflict', result.reason)
      return ok({ room: result.room })
    }

    if (action === 'budget' && method === 'POST') {
      return runControl.setBudget(room, await readBody())
    }

    if (action === 'acceptance' && method === 'POST') {
      const body = await readBody()
      return stages.setAcceptance(room, Number(body.stage), typeof body.command === 'string' ? body.command : '')
    }

    if (action === 'verify' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间能用引擎复核；演示房间请用模拟执行')
      if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
      const status = budgetStatus(room, readRooms())
      if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
      const body = await readBody()
      try {
        return accepted(await live.requestReview(room.id, Number(body.stage)))
      } catch (error) {
        if (error instanceof BusinessError) return fail(error.reason, error.message)
        throw error
      }
    }

    if (action === 'read' && method === 'POST') {
      if (room.live === true && typeof live.markChatRead === 'function') await live.markChatRead(room)
      return ok({ room: readRoom(roomId) ?? room })
    }

    if (action === 'snapshot' && method === 'GET') {
      return chat.snapshot(room)
    }

    if (room.state === 'paused' || room.state === 'stopped') {
      if (room.state === 'paused' && room.pauseReason === 'budget') {
        const status = budgetStatus(room, readRooms())
        return fail('conflict', `${status.message}；${budgetHint(status)}`)
      }
      return fail('conflict', room.state === 'paused' ? '房间已暂停' : '房间已停止')
    }

    if (action === 'messages' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 8000) return fail('invalid', '消息不能为空，且不超过 8000 字')
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
        if (live.busyReview(room.id)) return fail('conflict', '复核进行中，先等验收结论')
        const status = budgetStatus(room, readRooms())
        if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
        await live.send(room.id, text)
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
      const active = room.stages.find(stage => stage.state === 'active')
      if (room.openQuestion !== null && active?.kind === 'decision') {
        room.openQuestion = null
        writeRoom(room)
        emit('room', room)
        emit('dispatch', dispatchPayload())
      }
      return created({ message })
    }

    if (action === 'accept' && method === 'POST') {
      if (room.roomType === 'chat') return chat.accept(room)
      return stages.accept(room, await readBody())
    }

    if (action === 'chat-accept' && method === 'POST') {
      return chat.accept(room)
    }

    if (action === 'chat-continue' && method === 'POST') {
      return chat.continue(room, await readBody())
    }

    if (action === 'reject-plan' && method === 'POST') {
      return closure.rejectPlan(room, await readBody())
    }

    if (action === 'subrooms' && method === 'POST') {
      return subrooms.create(room, await readBody())
    }

    if (action === 'rework' && method === 'POST') {
      return stages.rework(room, await readBody())
    }

    if (action === 'simulate' && method === 'POST') {
      return simulateRoom({ readMessages, appendMessage, room })
    }

    return fail('method', '方法不对')
  }

  const plannerTool = async (roomId, tool) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (tool?.name === 'create_subroom') return subrooms.create(room, tool.args)
    if (tool?.name === 'reject_plan') return closure.rejectPlan(room, tool.args)
    if (tool?.name === 'check_gate') {
      const goal = typeof tool.args?.goal === 'string' && tool.args.goal.trim() !== '' ? tool.args.goal.trim() : room.goal
      const advisor = await ports.advisor?.advice?.({
        mode: 'gate',
        goal,
        roomType: 'studio',
        plan: null,
        verify: 'manual',
        acceptance: '',
      }) ?? { available: false, advice: [] }
      const gate = evaluateRoomGate({ roomType: 'studio', goal, plan: null, verify: 'manual', acceptance: '', advice: advisor.advice })
      return ok({ gate })
    }
    return fail('invalid', `未知 Planner 工具：${tool?.name ?? ''}`)
  }

  return {
    ...queries,
    plannerTool,
    ...delivery,
    resetMcp: runControl.resetMcp,
    removeSeat: seatActions.removeSeat,
    changeSeatRole: seatActions.changeSeatRole,
    createRoom,
    roomRequest,
    dispatchRequest: dispatch.request,
  }
}
