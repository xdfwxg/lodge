import { roomModeOfRoom } from './rooms/kinds.js'
import { leadMemberOf, memberOf } from './room-members.js'
import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
import { transitionAssignment } from './assignments.js'
import { createRealRoom } from './rooms/create/create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { createServiceClosure } from './rooms/studio/service-closure.js'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { createServiceSubrooms } from './rooms/studio/service-subrooms.js'
import { humanHandoffStageOf } from './human-handoff.js'
import { createModeSwitch } from './mode-switch.js'
import { createMemberAdd } from './member-add.js'
import { createMemberRemove } from './member-remove.js'
import { SAMPLE_ROOM_ID, sampleRoomRecord, seedSampleMessages } from './rooms/sample.js'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
const completionFacts = (room, messages = []) => {
  const stages = (room.stages ?? []).map((stage, index) => (
    `${index + 1}. ${stage.title}：${stage.state === 'passed' ? '通过' : stage.state}`
  )).join('\n')
  const verdicts = messages.filter(message => message.kind === 'verdict')
  const last = verdicts.at(-1)
  const name = last === undefined
    ? ''
    : (room.members ?? []).find(member => member.id === last.authorId)?.name ?? '验收员'
  const verdict = last === undefined
    ? '没有验收结论'
    : `${name} ${verdictPassed(last) ? 'PASS' : 'REJECT'}：${(judgmentOf(last)?.reason || String(last.text ?? '').split('\n')[0]).slice(0, 160)}`
  const files = new Set()
  for (const message of messages) {
    for (const file of message.meta?.changedFiles ?? []) files.add(file)
  }
  return [
    '房间事实（只依据这些回答，不要补充或推测）：',
    `目标：${room.goal}`,
    `阶段：\n${stages}`,
    `最后一次验收：${verdict}`,
    files.size === 0 ? '' : `改动文件：${[...files].join('、')}`,
    typeof room.branch === 'string' && room.branch !== '' ? `交付分支：${room.branch}` : '',
  ].filter(value => value !== '').join('\n')
}

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
  })
  const memoryRoom = room => {
    if (typeof room.completedCommit === 'string' && room.completedCommit !== '') return room
    try {
      const head = workspace.provider(room)?.head?.({ path: roomFiles.roomRootOf(room) })
      return typeof head === 'string' && head !== '' ? { ...room, workspaceHead: head } : room
    } catch {
      return room
    }
  }
  const recordMemory = room => {
    if (room === null || room === undefined || room.demo === true) return
    if (!Array.isArray(room.stages) || room.stages.length === 0) return
    if (!room.stages.every(stage => stage.state === 'passed')) return
    try {
      const result = ports.memory?.appendRoom?.({ room: memoryRoom(room), messages: readMessages(room.id) })
      if (result?.ok === false && result.reason !== 'demo' && result.reason !== 'no-workspace') {
        console.warn(`[lodge] 房间记忆没有写入：${result.reason}`)
      }
    } catch (error) {
      console.warn(`[lodge] 房间记忆没有写入：${error?.message ?? error}`)
    }
  }
  const finishRoom = createRoomCompleter({ store, emit, roomFiles, workspace }).completeRoom
  const completeRoom = room => {
    const done = finishRoom(room)
    recordMemory(done)
    return done
  }
  const stages = createServiceStages({ store, live, emit, completeRoom, roomFiles })
  const chat = createServiceChat({ store, live, emit })
  const modeSwitch = createModeSwitch({ store, engine, live, emit })
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

    if (action === 'resume' && method === 'POST') {
      if (room.state !== 'paused') return fail('conflict', '房间没有暂停')
      if (room.live !== true || live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const resumed = updateRoom(room.id, current => {
        current.state = 'active'
        current.idle = false
        current.pauseReason = null
        current.noProgress = 0
        return { events: [{ type: 'room.resumed' }] }
      })
      if (resumed === null) return fail('not_found', '没有这个房间')
      emit('room', resumed)
      try { await live.resume?.(room.id) } catch (error) {
        console.warn(`room resume failed: ${room.id} ${error?.message ?? error}`)
      }
      return ok({ room: readRoom(room.id) ?? resumed })
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
        let reattach = false
        const restored = updateRoom(room.id, current => {
          current.archivedAt = null
          // 归档停下的活动房间，恢复后要能继续；拒绝目标的停止不是归档造成的，保持原样。
          if (current.archivedLive === true) {
            delete current.archivedLive
            if (current.state === 'stopped' && current.pauseReason !== 'rejected') {
              current.state = 'active'
              current.pauseReason = null
              current.idle = false
            }
            if (current.state === 'active' || current.state === 'paused') {
              current.live = true
              reattach = true
            } else {
              current.live = false
            }
          }
          return { events: [{ type: 'room.restored' }] }
        })
        if (restored === null) return fail('not_found', '没有这个房间')
        emit('room', restored)
        let attachError = null
        if (reattach && live.isAttached?.(restored.id) !== true) {
          try {
            await live.attach?.(restored)
            reattach = false
          } catch (error) {
            attachError = error
            console.warn(`room restore attach failed: ${room.id} ${error?.message ?? error}`)
          }
        }
        if (reattach) {
          const failed = updateRoom(room.id, current => {
            current.connectionError = `基座连接中断：${attachError?.message ?? '房间没能连上'}`
            return { events: [{ type: 'room.connection', payload: { connected: false } }] }
          })
          if (failed !== null) emit('room', failed)
        }
        return ok({ room: readRoom(room.id) ?? restored })
      }
      const wasLive = room.live === true && live.isAttached?.(room.id) === true
      if (wasLive) {
        await live.cancel?.({ roomId: room.id })
        live.detach?.(room.id)
      }
      const archivedAt = Date.now()
      const updated = updateRoom(room.id, current => {
        current.archivedAt = archivedAt
        current.archivedLive = current.live === true
        const stopped = current.state === 'active'
        if (stopped) current.state = 'stopped'
        // 归档会把房间从基座摘下来；停在停止状态的房间也不该继续声称自己在线。
        if (stopped || wasLive) current.live = false
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
      // 删房时把成员身体和隐藏 Bot 一起退役；工作区和用户文件留着。
      try {
        await live.retireRoomBots?.(room)
      } catch (error) {
        console.warn(`room bots retire failed: ${room.id} ${error?.message ?? error}`)
      }
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
      const mentions = Array.isArray(body.mentions)
        ? body.mentions.filter(id => typeof id === 'string' && id !== '').slice(0, 8)
        : []
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
        if (live.busyReview(room.id)) return fail('conflict', '验收员还在看，等结论出来再继续')
        // 规划师已经把这步交给人：人的这句话就是补充上下文，直接重跑这一步。
        if (room.roomType === 'studio') {
          const handoff = humanHandoffStageOf(room, readMessages(room.id))
          if (handoff !== null) {
            const result = await stages.rework(room, { stage: handoff, note: text })
            if (result.ok !== true) return result
            return accepted({ room: result.body?.room ?? readRoom(room.id) })
          }
        }
        // 所有步骤都通过以后，房间进入完成态：只和规划师说话，不再派活。
        const allPassed = Array.isArray(room.stages) &&
          room.stages.length > 0 &&
          room.stages.every(stage => stage.state === 'passed')
        if (room.roomType === 'studio' && allPassed && typeof live.sendToMember === 'function') {
          const lead = leadMemberOf(room)?.id
          if (typeof lead === 'string' && lead !== '') {
            appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
            await live.sendToMember(roomId, lead, [
              text,
              completionFacts(room, readMessages(room.id)),
              '所有步骤都已经通过，这间房在收尾：不要再派活，也不要转给执行官或验收员。',
              '直接回答；要给新任务，建议人开一间新房。',
              '以本次给出的事实清单为准；和它冲突的旧说法作废。房间里没有的记录，直接说不知道，不要补全；不要调用工具。',
              INTERNAL_PROMPT_MARKER,
            ].join('\n'), { intent: 'chat', from: 'you' })
            return accepted({ accepted: true })
          }
        }
        // 聊天室里用户是在对主持说话；主持判断直接回答还是请成员讨论。
        // @ 是结构化指令，仍然直接交给被 @ 的成员。
        if (room.roomType === 'chat' && !text.includes('@')) {
          return chat.input(room, { note: text })
        }
        // 结论之后 @ 成员：开一轮有主持和上限的讨论，不让成员在结论外自由接力。
        if (room.roomType === 'chat' && room.chat?.phase === 'concluded' && room.chat?.running !== true) {
          return chat.continue(room, { note: text })
        }
        await live.send(room.id, text, { mentions })
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
      if (room.demo === true && room.roomType === 'chat') {
        appendMessage(roomId, { kind: 'system', text: '这是示例房间，不接模型；要动手就把结论转成工作室任务。' })
      }
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
      const result = stages.accept(room, await readBody())
      if (result.ok === true) recordMemory(result.body?.room ?? readRoom(roomId))
      return result
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

    if (action === 'retry' && method === 'POST') {
      return stages.retry(room, await readBody())
    }

    if (action === 'rewind' && method === 'POST') {
      return stages.rewind(room, await readBody())
    }

    if (action === 'switch-mode' && method === 'POST') {
      return modeSwitch.switchMode(room, await readBody())
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
    switchMode: modeSwitch.switchMode,
    // 房间记忆只读：只返回已交付房间的沉淀，不提供写入接口。
    memory: ({ roomId, limit = 20 } = {}) => {
      const room = readRoom(roomId)
      if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
      return ok({ entries: ports.memory?.list?.({ room, limit }) ?? [], readOnly: true })
    },
  }
}
