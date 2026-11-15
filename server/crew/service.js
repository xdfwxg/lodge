import { roomModeOfRoom } from './rooms/kinds.js'
import { createRealRoom } from './rooms/create/create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { createServiceClosure } from './rooms/studio/service-closure.js'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { createServiceSubrooms } from './rooms/studio/service-subrooms.js'
import { SAMPLE_ROOM_ID, sampleRoomRecord, seedSampleMessages } from './rooms/sample.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, seats, ports }) => {
  const { readRoom, readMessages, writeRoom, appendMessage, updateRoom, deleteRoom } = store
  const { roomFiles, workspace, files } = ports

  const queries = createServiceQueries({
    store,
    engine,
    seats,
    roomFiles,
    files,
    workspace,
  })
  const completeRoom = createRoomCompleter({ store, emit, roomFiles, workspace }).completeRoom
  const stages = createServiceStages({ store, live, emit, completeRoom, roomFiles })
  const chat = createServiceChat({ store, live, emit })
  const closure = createServiceClosure({ store, emit })

  const createRoom = (body, parent = null) => createRealRoom({ store, engine, live, emit, seats, body, ports, parentRoom: parent })
  const subrooms = createServiceSubrooms({ createRoom })

  const createSampleRoom = () => {
    const existing = readRoom(SAMPLE_ROOM_ID)
    if (existing !== null) {
      if (existing.archivedAt) {
        const restored = updateRoom(existing.id, current => {
          current.archivedAt = null
          return { events: [{ type: 'room.restored' }] }
        })
        if (restored !== null) emit('room', restored)
        return ok({ room: restored ?? existing })
      }
      return ok({ room: existing })
    }
    const now = Date.now()
    const room = writeRoom(sampleRoomRecord({ now }))
    seedSampleMessages({ store, room, now })
    emit('room', room)
    return ok({ room })
  }

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')

    if (action === 'approvals' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间有基座权限卡')
      if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
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
      if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
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

    if (action === 'rename' && method === 'POST') {
      const body = await readBody()
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '' || Array.from(name).length > 60) return fail('invalid', '房间名不能为空，且不超过 60 字')
      const updated = updateRoom(room.id, current => {
        current.name = name
        return { events: [{ type: 'room.renamed', payload: { name } }] }
      })
      if (updated === null) return fail('not_found', '没有这个房间')
      emit('room', updated)
      return ok({ room: updated })
    }

    if (action === 'archive' && method === 'POST') {
      const body = await readBody()
      if (body.archived === false) {
        const restored = updateRoom(room.id, current => {
          current.archivedAt = null
          return { events: [{ type: 'room.restored' }] }
        })
        if (restored === null) return fail('not_found', '没有这个房间')
        emit('room', restored)
        return ok({ room: restored })
      }
      const wasLive = room.live === true && live.isAttached?.(room.id) === true
      if (wasLive) {
        await live.cancel?.({ roomId: room.id })
        live.detach?.(room.id)
      }
      const archivedAt = Date.now()
      const updated = updateRoom(room.id, current => {
        current.archivedAt = archivedAt
        const stopped = current.state === 'active'
        if (stopped) {
          current.state = 'stopped'
          current.live = false
        }
        return { events: [{ type: 'room.archived', payload: { stopped } }] }
      })
      if (updated === null) return fail('not_found', '没有这个房间')
      emit('room', updated)
      return ok({ room: updated })
    }

    if (action === 'delete' && method === 'POST') {
      if (room.state === 'active') return fail('conflict', '正在进行的房间不能删除；先归档再删除')
      if (room.live === true && live.isAttached?.(room.id) === true) live.detach?.(room.id)
      if (typeof room.parentRoomId === 'string' && room.parentRoomId !== '') {
        const parent = updateRoom(room.parentRoomId, current => {
          current.childRoomIds = (current.childRoomIds ?? []).filter(id => id !== room.id)
          return { events: [{ type: 'room.child_removed', payload: { id: room.id } }] }
        })
        if (parent !== null) emit('room', parent)
      }
      const removed = typeof deleteRoom === 'function' ? deleteRoom(room.id) : false
      if (removed !== true) return fail('not_found', '没有这个房间')
      // 只删房间自己的 .crew/rooms/<id> 过程档案；交付工作区和用户仓库不碰。
      const roomRoot = roomFiles.roomDir?.(room)
      if (typeof roomRoot === 'string' && roomRoot !== '') {
        try { files.remove(roomRoot) } catch (error) {
          console.warn(`room files remove failed: ${room.id} ${error?.message ?? error}`)
        }
      }
      emit('room.deleted', { id: room.id, name: room.name })
      return ok({ id: room.id })
    }

    if (room.state === 'paused' || room.state === 'stopped') {
      return fail('conflict', room.state === 'paused' ? '房间已暂停' : '房间已停止')
    }

    if (action === 'messages' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 8000) return fail('invalid', '消息不能为空，且不超过 8000 字')
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
        if (live.busyReview(room.id)) return fail('conflict', '验收员还在看，等结论出来再继续')
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

    if (action === 'subrooms' && method === 'POST') {
      return subrooms.create(room, await readBody())
    }

    return fail('method', '方法不对')
  }

  return {
    ...queries,
    createRoom,
    createSampleRoom,
    roomRequest,
  }
}
