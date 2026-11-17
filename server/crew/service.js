import { roomModeOfRoom } from './rooms/kinds.js'
import { memberOf } from './room-members.js'
import { transitionAssignment } from './assignments.js'
import { createRealRoom } from './rooms/create/create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { requestedTurnLimitOf } from './room-types/chat.js'
import { createServiceClosure } from './rooms/studio/service-closure.js'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { createServiceSubrooms } from './rooms/studio/service-subrooms.js'
import { createMemberAdd } from './member-add.js'
import { createMemberRemove } from './member-remove.js'
import { recordShadowAdvice } from './rooms/studio/shadow-advisor.js'
import { SAMPLE_ROOM_ID, sampleRoomRecord, seedSampleMessages } from './rooms/sample.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, roles, ports }) => {
  const { readRoom, readMessages, writeRoom, appendMessage, updateRoom, deleteRoom } = store
  const { roomFiles, workspace, files } = ports

  const queries = createServiceQueries({
    store,
    engine,
    roles,
    roomFiles,
    files,
    workspace,
    advisor: ports.advisor,
  })
  const completeRoom = createRoomCompleter({ store, emit, roomFiles, workspace }).completeRoom
  const stages = createServiceStages({ store, live, emit, completeRoom, roomFiles })
  const chat = createServiceChat({ store, live, emit })
  const memberAdd = createMemberAdd({
    store,
    engine,
    emit,
    workspace,
    attachMember: (roomId, memberId) => live.attachMember?.(roomId, memberId),
  })
  const memberRemove = createMemberRemove({
    store,
    engine,
    emit,
    workspace,
    detachMember: (roomId, memberId) => live.detachMember?.(roomId, memberId),
  })
  const closure = createServiceClosure({ store, emit })

  // 子房间归档或删除时，父房里等它的那条交接不能一直停在 sent。
  const closeSubroomAssignment = (child, text) => {
    const parentId = child?.parentRoomId
    if (typeof parentId !== 'string' || parentId === '') return
    const assignments = store.readAssignments(parentId, { limit: 5000 })
    let changed = false
    for (const assignment of assignments) {
      if (assignment.reason !== 'subroom' || assignment.context?.childRoomId !== child.id) continue
      if (['passed', 'rejected', 'failed', 'cancelled'].includes(assignment.status)) continue
      if (transitionAssignment(store, assignment.id, 'cancelled', { resultText: String(text).slice(0, 4000) }) !== null) changed = true
    }
    if (!changed) return
    const parent = store.readRoom(parentId)
    if (parent !== null) emit('room', parent)
  }

  // 父房删除时，仍在进行的子房不能留下悬空的父子关系。
  const closeChildRooms = async room => {
    for (const childId of room.childRoomIds ?? []) {
      const child = store.readRoom(childId)
      if (child === null) continue
      if (child.live === true && live.isAttached?.(child.id) === true) {
        await live.cancel?.({ roomId: child.id })
        live.detach?.(child.id)
      }
      const updated = updateRoom(child.id, current => {
        current.archivedAt = current.archivedAt ?? Date.now()
        if (current.state === 'active') {
          current.state = 'stopped'
          current.live = false
        }
        current.parentRoomId = null
        current.parentAssignmentId = null
        return { events: [{ type: 'room.parent_removed', payload: { id: room.id } }] }
      })
      if (updated !== null) emit('room', updated)
    }
  }

    const createRoom = (body, parent = null) => createRealRoom({ store, engine, live, emit, roles, body, ports, parentRoom: parent })
  const subrooms = createServiceSubrooms({ createRoom, store, emit })

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
      if (room.live !== true) return fail('conflict', '只有正在运行的房间有待确认的操作')
      if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const approvalId = typeof body.id === 'string' ? body.id : ''
      const decision = body.decision === 'allow' ? 'allow' : body.decision === 'deny' ? 'deny' : ''
      if (approvalId === '') return fail('invalid', '缺少要确认的操作')
      if (decision === '') return fail('invalid', '这个操作只能选“可以做”或“先别做”')
      const result = await live.decideApproval(room.id, approvalId, decision)
      if (result.ok !== true) return fail('conflict', result.reason)
      return ok({ room: result.room })
    }

    if (action === 'acceptance' && method === 'POST') {
      const body = await readBody()
      return stages.setAcceptance(room, Number(body.stage), typeof body.command === 'string' ? body.command : '')
    }

    if (action === 'verify' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能真的检查；示例房间用示例数据')
      if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      try {
        return accepted(await live.requestReview(room.id, Number(body.stage)))
      } catch (error) {
        if (error instanceof BusinessError) return fail(error.reason, error.message)
        throw error
      }
    }

    if (action === 'shadow-review' && method === 'POST') {
      if (room.roomType !== 'studio') return fail('conflict', '只有工作室能用第二意见')
      const body = await readBody()
      if (body.enabled === true) {
        const described = ports.advisor?.describe?.() ?? { available: false, host: '' }
        if (described.available !== true) return fail('conflict', '还没配置第二意见的外部服务')
        const updated = updateRoom(room.id, current => {
          current.shadowReview = true
          current.advisorConsent = { host: described.host, at: Date.now() }
          delete current.advisorShadow
          return { events: [{ type: 'room.shadow_review', payload: { enabled: true, host: described.host } }] }
        })
        if (updated === null) return fail('not_found', '没有这个房间')
        appendMessage(room.id, {
          kind: 'system',
          text: `第二意见已${room.shadowReview === true ? '重新确认' : '开启'}。复核时会把证据和改动发给外部服务${described.host === '' ? '' : `（${described.host}）`}，只供参考。`,
          meta: { advisorNotice: true },
        })
        emit('room', updated)
        const current = readRoom(room.id) ?? updated
        const index = (current.stages ?? []).findIndex(stage => stage.state === 'active')
        const stage = index >= 0 ? current.stages[index] : undefined
        const evidence = index < 0
          ? undefined
          : [...readMessages(room.id)].reverse().find(message => (
            message.kind === 'evidence' &&
            (message.meta?.stage ?? 0) === index &&
            (message.meta?.kind === 'manual' || message.meta?.kind === 'command')
          ))
        if (stage !== undefined && evidence !== undefined) {
          void recordShadowAdvice({
            store,
            roomId: room.id,
            advisor: ports.advisor,
            room: current,
            emit,
            index,
            stage,
            evidence,
            manual: stage.manual === true,
          }).catch(error => appendMessage(room.id, { kind: 'system', text: `第二意见没能取回：${error?.message ?? error}` }))
        }
        return ok({ room: current })
      }
      const updated = updateRoom(room.id, current => {
        current.shadowReview = false
        delete current.advisorConsent
        delete current.advisorShadow
        return { events: [{ type: 'room.shadow_review', payload: { enabled: false } }] }
      })
      if (updated === null) return fail('not_found', '没有这个房间')
      appendMessage(room.id, { kind: 'system', text: '第二意见已关闭。' })
      emit('room', updated)
      return ok({ room: readRoom(room.id) ?? updated })
    }

    if (action === 'read' && method === 'POST') {
      if (room.live === true && typeof live.markChatRead === 'function') await live.markChatRead(room)
      return ok({ room: readRoom(roomId) ?? room })
    }

    if (action === 'answer-card' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能回答问题')
      if (live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const memberId = typeof body.memberId === 'string' ? body.memberId : ''
      const requestId = typeof body.requestId === 'string' ? body.requestId : ''
      const message = typeof body.message === 'string' ? body.message : ''
      const result = await live.answerCard(room.id, memberId, requestId, message)
      if (result.ok !== true) return fail('conflict', result.reason)
      return ok({ room: result.room })
    }

    if (action === 'cancel-queue' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能撤回排队消息')
      const body = await readBody()
      const queueId = typeof body.queueId === 'string' ? body.queueId : ''
      if (queueId === '') return fail('invalid', '缺少排队消息')
      try {
        const result = await live.cancelQueued(room.id, queueId)
        return result.cancelled === true ? ok(result) : fail('conflict', result.reason)
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
    }

    if (action === 'steer' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能插话')
      if (live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const queueId = typeof body.queueId === 'string' ? body.queueId : ''
      if (queueId === '') return fail('invalid', '缺少排队消息')
      try {
        return ok(await live.steerQueued(room.id, queueId))
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
    }

    if (action === 'hold' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能叫停成员')
      if (live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const memberId = typeof body.memberId === 'string' ? body.memberId : ''
      if (memberOf(room, memberId) === null) return fail('invalid', '没有这个成员')
      try {
        const updated = await live.holdMember(room.id, memberId, body.held === true)
        return ok({ room: updated ?? readRoom(room.id) ?? room })
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
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
      if (updated.parentRoomId) closeSubroomAssignment(updated, `子房间「${updated.name}」已归档。`)
      return ok({ room: updated })
    }

    if (action === 'delete' && method === 'POST') {
      if (room.state === 'active') return fail('conflict', '正在进行的房间不能删除；先归档再删除')
      if (room.live === true && live.isAttached?.(room.id) === true) live.detach?.(room.id)
      if (room.parentRoomId) closeSubroomAssignment(room, `子房间「${room.name}」已删除。`)
      await closeChildRooms(room)
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

    // 添加成员与换身体允许在暂停时进行（例如模型登录失效后补人），放在暂停门禁之前。
    if (action === 'add-member' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '房间没有连上，不能加成员')
      return memberAdd.add(room, await readBody())
    }

    if (action === 'remove-member' && method === 'POST') {
      return memberRemove.remove(room, await readBody())
    }

    if (action === 'swap-body' && method === 'POST') {
      if (room.live !== true || typeof live.swapBody !== 'function') return fail('conflict', '当前房间没有可换的身体')
      return live.swapBody(room, await readBody())
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
        // 带 @ 的消息交给基座原生群聊，由被 @ 的成员回答；次数请求由调度器开一轮，已确认的聊天室则先重开。
        const chatRoundRequested = room.roomType === 'chat'
          && !text.includes('@')
          && requestedTurnLimitOf(text) !== null
          && (room.chat?.phase === 'awaiting_decision'
            || (room.state === 'complete' && room.chat?.phase === 'accepted'))
        if (chatRoundRequested) return chat.continue(room, { note: text })
        await live.send(room.id, text)
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
      const active = room.stages.find(stage => stage.state === 'active')
      if (room.openQuestion !== null && active?.kind === 'decision') {
        const updated = updateRoom(roomId, current => {
          current.openQuestion = null
          return { events: [] }
        })
        if (updated !== null) emit('room', updated)
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
