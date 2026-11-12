import { budgetHint, budgetStatus } from './budget.js'
import { simulateRoom } from './demo.js'
import { createDispatchService } from './dispatch-service.js'
import { createRealRoom } from './room-create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './room-complete.js'
import { createServiceDelivery } from './service-delivery.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceRunControl } from './service-run-control.js'
import { createServiceSeats } from './service-seats.js'
import { createServiceStages } from './service-stages.js'
import { createServiceTemplates } from './service-templates.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, dispatchPayload, seats, dataDir }) => {
  const { readRoom, readRooms, readMessages, writeRoom, appendMessage } = store
  const dispatch = createDispatchService({ store, emit, dispatchPayload })

  const queries = createServiceQueries({ store, engine, seats, dataDir, dispatchPayload })
  const templates = createServiceTemplates({ dataDir })
  const delivery = createServiceDelivery({ store, dataDir, emit, dispatchPayload })
  const seatActions = createServiceSeats({ store, engine, live, emit })
  const completeRoom = createRoomCompleter({ store, emit }).completeRoom
  const stages = createServiceStages({ store, live, emit, dispatchPayload, completeRoom })
  const runControl = createServiceRunControl({ store, live, emit, dispatchPayload })

  const createRoom = body => createRealRoom({ store, engine, live, emit, seats, dispatchPayload, body })

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.imported === true) return fail('conflict', '交接记录只读；要继续工作，请对照 BRIEF 与证据新建房间')

    if ((action === 'pause' || action === 'resume' || action === 'stop') && method === 'POST') {
      return runControl.control(room, action)
    }

    if (action === 'seats' && method === 'POST') {
      return seatActions.addSeat(room, await readBody())
    }

    if (action === 'stages' && method === 'POST') {
      return stages.editStagePlan(room, await readBody())
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
      return stages.accept(room, await readBody())
    }

    if (action === 'simulate' && method === 'POST') {
      return simulateRoom({ readMessages, appendMessage, room })
    }

    return fail('method', '方法不对')
  }

  return {
    ...queries,
    ...templates,
    ...delivery,
    resetMcp: runControl.resetMcp,
    removeSeat: seatActions.removeSeat,
    changeSeatRole: seatActions.changeSeatRole,
    createRoom,
    roomRequest,
    dispatchRequest: dispatch.request,
  }
}
