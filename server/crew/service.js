import { roomModeOfRoom } from './rooms/kinds.js'
import { createRealRoom } from './rooms/create/create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { createServiceClosure } from './rooms/studio/service-closure.js'
import { createServiceStages } from './rooms/studio/service-stages.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, seats, ports }) => {
  const { readRoom, readMessages, writeRoom, appendMessage } = store
  const { roomFiles, workspace, files } = ports

  const queries = createServiceQueries({
    store,
    engine,
    seats,
    roomFiles,
    files,
  })
  const completeRoom = createRoomCompleter({ store, emit, roomFiles, workspace }).completeRoom
  const stages = createServiceStages({ store, live, emit, completeRoom, roomFiles })
  const chat = createServiceChat({ store, live, emit })
  const closure = createServiceClosure({ store, emit })

  const createRoom = body => createRealRoom({ store, engine, live, emit, seats, body, ports })

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')

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

    if (action === 'acceptance' && method === 'POST') {
      const body = await readBody()
      return stages.setAcceptance(room, Number(body.stage), typeof body.command === 'string' ? body.command : '')
    }

    if (action === 'verify' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间能用引擎复核；演示房间请用模拟执行')
      if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
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

    if (room.state === 'paused' || room.state === 'stopped') {
      return fail('conflict', room.state === 'paused' ? '房间已暂停' : '房间已停止')
    }

    if (action === 'messages' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 8000) return fail('invalid', '消息不能为空，且不超过 8000 字')
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
        if (live.busyReview(room.id)) return fail('conflict', '复核进行中，先等验收结论')
        await live.send(room.id, text)
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
      const active = room.stages.find(stage => stage.state === 'active')
      if (room.openQuestion !== null && active?.kind === 'decision') {
        room.openQuestion = null
        writeRoom(room)
        emit('room', room)
      }
      return created({ message })
    }

    if (action === 'accept' && method === 'POST') {
      if (roomModeOfRoom(room)?.acceptsChatDecision === true) return chat.accept(room)
      return stages.accept(room, await readBody())
    }

    if (action === 'chat-accept' && method === 'POST') {
      return chat.accept(room)
    }

    if (action === 'chat-continue' && method === 'POST') {
      return chat.continue(room, await readBody())
    }

    if (action === 'chat-resume' && method === 'POST') {
      return chat.restart(room, await readBody())
    }

    if (action === 'reject-plan' && method === 'POST') {
      return closure.rejectPlan(room, await readBody())
    }

    if (action === 'rework' && method === 'POST') {
      return stages.rework(room, await readBody())
    }

    return fail('method', '方法不对')
  }

  return {
    ...queries,
    createRoom,
    roomRequest,
  }
}
