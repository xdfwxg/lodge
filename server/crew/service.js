import { resolve, sep } from 'node:path'
import { roomModeOfRoom } from './rooms/kinds.js'
import { leadMemberOf, memberOf } from './room-members.js'
import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
import { cancelOpenAssignments, transitionAssignment } from './assignments.js'
import { createRealRoom } from './rooms/create/create.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { startRound } from './rounds/start.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { createServiceClosure } from './rooms/studio/service-closure.js'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { humanHandoffStageOf } from './rooms/studio/human-handoff.js'
import { createMemberAdd } from './member-add.js'
import { createMemberRemove } from './member-remove.js'
import {
  SAMPLE_CHAT_ROOM_ID,
  SAMPLE_ROOM_ID,
  sampleChatRoomRecord,
  sampleRoomRecord,
  seedSampleChatMessages,
  seedSampleMessages,
} from './rooms/sample.js'
import { artifactKindOf, imageMimeOf } from '../../shared/artifact.js'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'
import {
  catchUpRoutineAt,
  normalizeDays,
  parseHour,
  parseMinute,
  routineOf,
  routineTimerId,
  scheduleLabelOf,
} from '../../shared/routine.js'
import { systemNotice } from './notices.js'
import { cleanHumanName, setCurrentHumanName } from './human-name.js'
import { isAttachmentName, normalizeAttachments, textOfFile } from './attachments.js'
import {
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_BYTES,
  attachmentNameOf,
  formatAttachmentBytes,
  isNativeImage,
  isTextFile,
  withAttachments,
} from '../../shared/attachments.js'

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

export const createCrewService = ({ store, engine, live, emit, roles, ports, attachments = null }) => {
  const { readRoom, readMessages, writeRoom, appendMessage, updateRoom, deleteRoom } = store
  const { roomFiles, workspace, files } = ports
  const readStoredProfile = () => (
    typeof store.readProfile === 'function'
      ? store.readProfile()
      : { name: '', avatar: null, updatedAt: null }
  )
  let profile = readStoredProfile()
  // 迁移旧房间里的称呼：第一次启动时把已有的名字收进全局资料。
  if (cleanHumanName(profile.name) === '') {
    const rooms = typeof store.readRooms === 'function' ? store.readRooms() : []
    const legacy = rooms
      .map(room => cleanHumanName(room.humanName))
      .find(name => name !== '') ?? ''
    if (legacy !== '') {
      profile = typeof store.writeProfile === 'function'
        ? store.writeProfile({ ...profile, name: legacy })
        : { ...profile, name: legacy }
    }
  }
  setCurrentHumanName(profile.name)

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
  const stages = createServiceStages({ store, live, emit, completeRoom, roomFiles, workspace: ports.workspace })
  // 规划师对齐回合结束后由实时层回调：对齐这一步没有界面动作，自动确认后继续。
  live.setConfirmStage?.((roomId, index) => {
    const room = store.readRoom(roomId)
    if (room === null) return null
    return stages.accept(room, { stage: index })
  })
  // 合并冲突留给人：打开冲突目录、解决并提交，再由这里清掉冲突继续验收。
  const resolveMerge = async room => {
    const conflict = room?.mergeConflict
    if (conflict === null || conflict === undefined) return fail('conflict', '这一步没有合并冲突')
    const path = typeof conflict.path === 'string' && conflict.path !== '' ? conflict.path : room.repoPath
    const provider = workspace.provider(room)
    if (typeof path !== 'string' || path === '' || typeof provider.changes !== 'function') {
      return fail('unavailable', '冲突目录现在不可用')
    }
    let state = null
    try {
      state = await provider.changes({ path })
    } catch (error) {
      return fail('unavailable', `读不到冲突目录：${error?.message ?? error}`)
    }
    const status = typeof state?.status === 'string' ? state.status.trim() : ''
    const diff = typeof state?.diff === 'string' ? state.diff : ''
    if (/^(UU|AA|DD|AU|UA|DU|UD) /m.test(status)) return fail('conflict', '还有没解决的冲突文件')
    if (status !== '') return fail('conflict', '解决结果还没有提交；先提交再继续')
    if (diff.includes('<<<<<<<')) return fail('conflict', '文件里还留着冲突标记')
    const updated = updateRoom(room.id, current => {
      current.mergeConflict = null
      current.mergeResolved = { stage: conflict.stage, at: Date.now() }
      return { events: [{ type: 'room.merge_resolved', payload: { stage: conflict.stage } }] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    appendMessage(room.id, { kind: 'system', text: '合并冲突已经处理，继续验收。' })
    appendMessage(room.id, {
      kind: 'chat',
      authorId: 'you',
      text: '我在冲突目录里处理了合并：保留两条内容并提交，冲突已经由我解决。',
      meta: { stage: conflict.stage, source: 'merge' },
    })
    emit('room', updated)
    if (room.live === true && typeof live.resolveMerged === 'function') {
      try {
        await live.resolveMerged(room.id, conflict.stage)
      } catch (error) {
        systemNotice({ store, roomId: room.id, text: '冲突处理完了，但验收没有接上；待处理。', error })
      }
    }
    return ok({ room: updated })
  }
  const chat = createServiceChat({ store, live, emit })
  const memberAdd = createMemberAdd({
    store,
    engine,
    emit,
    workspace,
    browserMcp: ports.browserMcp ?? null,
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

  // 归档或删除目标房时，正在跑的那一次也一起停；例行工作不能留在后台无声地跑。
  const stopRoutineRun = async (room, reason) => {
    const routine = routineOf(room)
    if (routine?.lastRoomId === null || routine?.lastRoomId === undefined) return
    const runRoom = store.readRoom(routine.lastRoomId)
    if (runRoom === null || runRoom.state !== 'active') return
    if (runRoom.live === true && live.isAttached?.(runRoom.id) === true) {
      await live.cancel?.({ roomId: runRoom.id })
      live.detach?.(runRoom.id)
    }
    const stopped = updateRoom(runRoom.id, current => {
      current.state = 'stopped'
      current.live = false
      return { events: [{ type: 'room.stopped', payload: { reason } }] }
    })
    if (stopped !== null) emit('room', stopped)
  }

    const createRoom = (body, parent = null) => createRealRoom({ store, engine, live, emit, roles, body, ports, parentRoom: parent })

  const createSampleRoom = (kind = 'studio') => {
    const chat = kind === 'chat'
    const id = chat ? SAMPLE_CHAT_ROOM_ID : SAMPLE_ROOM_ID
    const existing = readRoom(id)
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
    const created = writeRoom(chat ? sampleChatRoomRecord({ now }) : sampleRoomRecord({ now }))
    if (chat) seedSampleChatMessages({ store, room: created })
    else seedSampleMessages({ store, room: created, now })
    const room = readRoom(id) ?? created
    emit('room', room)
    return ok({ room })
  }

  // 用户改过名字后，下一次说话把房间里的称呼一起更新；提示词和历史都用这个名字。
  const saveHumanProfile = input => {
    const raw = cleanHumanName(input?.name)
    const name = raw === '你' ? '' : raw
    const avatar = typeof input?.avatar === 'string' &&
      input.avatar.startsWith('data:image/') &&
      input.avatar.length <= 512 * 1024
      ? input.avatar
      : null
    const next = { name, avatar, updatedAt: Date.now() }
    profile = typeof store.writeProfile === 'function' ? store.writeProfile(next) : next
    setCurrentHumanName(profile.name)
    // 全局资料也是全局窗口的事实：改名后所有打开的窗口立即读到同一份。
    emit('profile', profile)
    return ok({ profile })
  }

  // 旧客户端消息里带的称呼只在全局还没名字时收下；资料接口是唯一写入口。
  const rememberHuman = (roomId, body) => {
    const name = cleanHumanName(body?.humanName)
    if (name === '' || profile.name !== '') return
    saveHumanProfile({ name, avatar: profile.avatar })
  }

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    let room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')

    // Lodge 的对话：一句话决定开工作室还是留下聊聊，不出现房型选择。
    if (action === 'lodge' && method === 'POST') {
      if (room.lodge !== true) return fail('invalid', '这不是 Lodge 对话')
      if (room.state !== 'active') return fail('conflict', 'Lodge 现在没有在运行')
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : ''
      const normalized = normalizeAttachments(body.attachments)
      if (normalized.error !== undefined) return fail('invalid', normalized.error)
      const attachments = normalized.attachments
      if (text === '' && attachments.length === 0) return fail('invalid', '说一句想做什么')
      rememberHuman(room.id, body)
      room = readRoom(room.id) ?? room
      const userMessage = appendMessage(room.id, {
        kind: 'chat',
        authorId: 'you',
        text,
        ...(attachments.length === 0 ? {} : { meta: { attachments } }),
      })
      if (room.live !== true || live.isAttached?.(room.id) !== true) {
        return fail('conflict', 'Lodge 还没有连上模型服务')
      }
      // 主持这一轮同时回答和判断：要做事或找人时会带回 open，不用再问一次前台。
      const reply = await chat.input(room, { note: withAttachments(text, attachments) })
      if (reply?.ok !== true) return reply
      const decision = reply.body?.intent ?? null
      if (decision?.action !== 'open') {
        return ok({ room: readRoom(room.id) ?? room, message: userMessage })
      }
      // 附件跟着目标一起进新房：给模型的是带标记的目标，界面上仍只显示人写的那句话。
      const goalText = text === '' ? (attachments[0]?.title ?? '看看这个附件') : text
      const created = await createRoom({
        goal: withAttachments(goalText, attachments),
        name: goalText.slice(0, 24),
        verify: 'manual',
        ...(decision.room === 'chat' ? { roomType: 'chat' } : {}),
      })
      if (created?.ok !== true) return created
      const createdRoom = created.body?.room ?? null
      if (decision.reply !== '') {
        appendMessage(room.id, { kind: 'chat', authorId: 'lodge', text: decision.reply })
      }
      appendMessage(room.id, {
        kind: 'chat',
        authorId: 'lodge',
        text: `开好了：${createdRoom?.name ?? '一间工作室'}`,
        ...(createdRoom === null ? {} : {
          meta: {
            openRoomId: createdRoom.id,
            openRoomName: createdRoom.name,
            createdRoomId: createdRoom.id,
          },
        }),
      })
      emit('room', readRoom(room.id) ?? room)
      return ok({ room: readRoom(room.id) ?? room, createdRoom })
    }

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
      const disconnected = typeof room.connectionError === 'string' && room.connectionError !== ''
      if (room.state !== 'paused' && !disconnected) return fail('conflict', '房间没有暂停')
      if (room.live !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      if (live.isAttached?.(room.id) !== true) {
        try {
          await live.attach?.(room)
        } catch {
          return fail('conflict', '房间现在没有连上，稍后再试')
        }
      }
      const resumed = updateRoom(room.id, current => {
        const events = []
        if (current.state === 'paused') {
          current.state = 'active'
          current.idle = false
          current.pauseReason = null
          current.noProgress = 0
          events.push({ type: 'room.resumed' })
        }
        if (typeof current.connectionError === 'string' && current.connectionError !== '') {
          delete current.connectionError
          events.push({ type: 'room.connection', payload: { connected: true } })
        }
        return events.length === 0 ? null : { events }
      })
      if (resumed === null) return fail('not_found', '没有这个房间')
      emit('room', resumed)
      if (room.state === 'paused') {
        try { await live.resume?.(room.id) } catch (error) {
          console.warn(`room resume failed: ${room.id} ${error?.message ?? error}`)
        }
      }
      return ok({ room: readRoom(room.id) ?? resumed })
    }

    // 输入条上的方块只停下这次回复，不把房间变成暂停态；停完可以直接说下一步。
    if (action === 'interrupt' && method === 'POST') {
      if (room.state !== 'active') return fail('conflict', '房间没有在跑')
      if (room.live !== true || live.isAttached?.(room.id) !== true) {
        return fail('conflict', '房间现在没有连上，稍后再试')
      }
      const cancelled = await live.cancel?.({ roomId: room.id })
      const cancelledAssignments = room.roomType === 'studio'
        ? cancelOpenAssignments(store, room.id, { reason: '用户停下了这次回复' })
        : 0
      const updated = readRoom(room.id) ?? room
      emit('room', updated)
      return ok({
        room: updated,
        cancelled: cancelled?.cancelled === true,
        assignments: cancelledAssignments,
      })
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
      if (routineOf(room)?.unseenResult === true) {
        const updated = updateRoom(room.id, current => {
          current.routine = { ...(current.routine ?? {}), unseenResult: false }
          return { events: [] }
        })
        if (updated !== null) {
          emit('room', readRoom(room.id) ?? updated)
          return ok({ room: readRoom(room.id) ?? updated })
        }
      }
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
            current.connectionError = `Lodge 服务连接中断：${attachError?.message ?? '房间没能连上'}`
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
      const routine = routineOf(room)
      await stopRoutineRun(room, 'routine-archived')
      const archivedAt = Date.now()
      const updated = updateRoom(room.id, current => {
        current.archivedAt = archivedAt
        current.archivedLive = current.live === true
        const stopped = current.state === 'active'
        if (stopped) current.state = 'stopped'
        // 归档会把房间从基座摘下来；停在停止状态的房间也不该继续声称自己在线。
        if (stopped || wasLive) current.live = false
        if (routine?.enabled === true) {
          current.routine = {
            ...(current.routine ?? {}),
            enabled: false,
            paused: false,
            nextRunAt: null,
            skippedAt: null,
            unseenResult: false,
          }
        }
        return {
          events: [
            { type: 'room.archived', payload: { stopped } },
            ...(routine?.enabled === true ? [{ type: 'room.routine.stopped', payload: { reason: 'archived' } }] : []),
          ],
        }
      })
      if (updated === null) return fail('not_found', '没有这个房间')
      if (routine?.enabled === true) {
        store.cancelTimer?.(routineTimerId(room.id))
        appendMessage(room.id, {
          kind: 'system',
          text: '已归档，例行工作先停下；取消归档后可以再开。',
        })
      }
      emit('room', updated)
      if (updated.parentRoomId) closeSubroomAssignment(updated, `子房间「${updated.name}」已归档。`)
      return ok({ room: updated })
    }

    if (action === 'delete' && method === 'POST') {
      if (room.state === 'active') return fail('conflict', '正在进行的房间不能删除；先归档再删除')
      if (routineOf(room)?.enabled === true) store.cancelTimer?.(routineTimerId(room.id))
      await stopRoutineRun(room, 'room-deleted')
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
      if (room.live !== true || typeof live.swapBody !== 'function') return fail('conflict', '当前房间不能调整成员')
      return live.swapBody(room, await readBody())
    }

    if (room.state === 'paused' || room.state === 'stopped') {
      return fail('conflict', room.state === 'paused' ? '房间已暂停' : '房间已停止')
    }

    // 已交付的房间里说一句要改什么：在同一个工作间开下一轮，不新建房间。
    if (action === 'rounds' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      const normalized = normalizeAttachments(body.attachments)
      if (normalized.error !== undefined) return fail('invalid', normalized.error)
      const attachments = normalized.attachments
      if (text === '' && attachments.length === 0) return fail('invalid', '说一句这一轮要做什么')
      rememberHuman(room.id, body)
      const result = await startRound({
        store,
        live,
        emit,
        room,
        body: {
          goal: withAttachments(text, attachments),
          ...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}),
          ...(body.plan !== null && typeof body.plan === 'object' ? { plan: body.plan } : {}),
          ...(body.verify === 'test' ? {
            verify: 'test',
            acceptance: typeof body.acceptance === 'string' ? body.acceptance : '',
          } : {}),
        },
        roomFiles,
      })
      if (result?.ok !== true) return result
      appendMessage(room.id, {
        kind: 'chat',
        authorId: 'you',
        text,
        ...(attachments.length === 0 ? {} : { meta: { attachments } }),
      })
      const updated = result.body?.room ?? store.readRoom(room.id) ?? room
      emit('room', updated)
      return accepted({ room: updated })
    }

    if (action === 'messages' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      const normalized = normalizeAttachments(body.attachments)
      if (normalized.error !== undefined) return fail('invalid', normalized.error)
      const attachments = normalized.attachments
      if (text === '' && attachments.length === 0) return fail('invalid', '消息不能为空，且不超过 8000 字')
      if (text.length > 8000) return fail('invalid', '消息不能为空，且不超过 8000 字')
      rememberHuman(room.id, body)
      room = readRoom(room.id) ?? room
      const mentions = Array.isArray(body.mentions)
        ? body.mentions.filter(id => typeof id === 'string' && id !== '').slice(0, 8)
        : []
      const attachmentMeta = attachments.length === 0 ? {} : { attachments }
      const promptText = withAttachments(text, attachments)
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
        if (live.busyReview(room.id)) return fail('conflict', '验收员还在看，等结论出来再继续')
        const mode = roomModeOfRoom(room)
        const messages = readMessages(room.id)
        const policy = mode?.messagePolicy?.({ room, text, messages }) ?? null
        // 规划师已经把这步交给人：人的这句话就是补充上下文，直接重跑这一步。
        if (policy?.type === 'human-rework') {
          const result = await stages.rework(room, { stage: policy.stage, note: promptText })
          if (result.ok !== true) return result
          return accepted({ room: result.body?.room ?? readRoom(room.id) })
        }
        // 所有步骤都通过以后，房间进入完成态：只和规划师说话，不再派活。
        if (policy?.type === 'final-chat' && typeof live.sendToMember === 'function') {
          const lead = leadMemberOf(room)?.id
          if (typeof lead === 'string' && lead !== '') {
            appendMessage(roomId, { kind: 'chat', authorId: 'you', text, ...(attachments.length === 0 ? {} : { meta: attachmentMeta }) })
            await live.sendToMember(roomId, lead, [
              promptText,
              completionFacts(room, messages),
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
        if (policy?.type === 'host') return chat.input(room, { note: promptText })
        // 结论之后 @ 成员：开一轮有主持和上限的讨论，不让成员在结论外自由接力。
        if (policy?.type === 'continue') return chat.continue(room, { note: promptText })
        await live.send(room.id, promptText, { mentions })
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text, ...(attachments.length === 0 ? {} : { meta: attachmentMeta }) })
      const demoMessage = roomModeOfRoom(room)?.demoMessage
      if (room.demo === true && typeof demoMessage === 'string' && demoMessage !== '') {
        appendMessage(roomId, { kind: 'system', text: demoMessage })
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

    if (action === 'human-choice' && method === 'POST') {
      if (room.state !== 'active') return fail('conflict', '房间没有在跑')
      const body = await readBody()
      const stage = Number(body.stage)
      const choice = body.choice === 'accept' ? 'accept' : body.choice === 'rework' ? 'rework' : ''
      if (choice === '') return fail('invalid', '选择只能是接受或重做')
      const handoff = humanHandoffStageOf(room, readMessages(room.id))
      if (handoff !== stage) return fail('conflict', '这一步没有等你决定')
      if (choice === 'accept') {
        const result = stages.accept(room, { stage, force: true })
        if (result.ok === true) recordMemory(result.body?.room ?? readRoom(roomId))
        return result
      }
      return stages.rework(room, {
        stage,
        note: typeof body.note === 'string' ? body.note : '',
      })
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

    if (action === 'resolve-merge' && method === 'POST') {
      return resolveMerge(room)
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

    return fail('method', '方法不对')
  }

  return {
    ...queries,
    createRoom,
    createSampleRoom,
    roomRequest,
    // 附件进基座自己的库：图片成为原生视觉输入，文件按路径交给能读文件的人。
    uploadAttachment: async ({ bytes, mime, name } = {}) => {
      if (attachments === null) return fail('unavailable', '附件功能还没有接上')
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) return fail('invalid', '没有收到文件')
      const type = String(mime ?? '').toLowerCase()
      const image = isNativeImage(type)
      const max = image ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_FILE_MAX_BYTES
      if (bytes.length > max) return fail('invalid', `附件太大（最多 ${formatAttachmentBytes(max)}）`)
      try {
        if (image) {
          const saved = await attachments.uploadImage(bytes, type)
          const savedName = attachmentNameOf(saved?.path)
          if (!isAttachmentName(savedName)) return fail('upstream', 'Lodge 服务没有存下这张图')
          return ok({
            attachment: {
              kind: 'image',
              name: savedName,
              path: saved.path,
              mime: saved.mime ?? type,
              bytes: saved.bytes ?? bytes.length,
              title: String(name ?? '').trim().slice(0, 120) || savedName,
            },
          })
        }
        const wanted = String(name ?? '').trim().slice(0, 120) || 'file'
        const saved = await attachments.uploadFile(bytes, wanted, type || 'application/octet-stream')
        // 基座把原始文件名放在 name 里，磁盘上是 uuid；路径必须用磁盘名，显示用原名。
        const savedName = attachmentNameOf(saved?.path)
        if (!isAttachmentName(savedName)) return fail('upstream', 'Lodge 服务没有存下这个文件')
        const title = typeof saved?.name === 'string' && saved.name !== '' ? saved.name : wanted
        const text = isTextFile(type) ? textOfFile(bytes) : ''
        return ok({
          attachment: {
            kind: 'file',
            name: savedName,
            path: saved.path,
            mime: saved.mime ?? type,
            bytes: saved.bytes ?? bytes.length,
            title,
            ...(text === '' ? {} : { text }),
          },
        })
      } catch (error) {
        return fail('upstream', String(error?.message ?? error))
      }
    },
    attachmentBytes: async ({ name } = {}) => {
      if (attachments === null) return fail('unavailable', '附件功能还没有接上')
      if (!isAttachmentName(name)) return fail('not_found', '没有这个附件')
      try {
        const file = await attachments.attachment(name)
        return ok({ bytes: file.bytes, mime: file.mime })
      } catch {
        return fail('not_found', '没有这个附件')
      }
    },
    // 房间记忆：人审核后发布，成员只读；不提供模型写入接口。
    artifact: ({ roomId, path } = {}) => {
      const room = readRoom(roomId)
      if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
      const target = typeof path === 'string' ? path.trim() : ''
      if (target === '') return fail('invalid', '缺少文件路径')
      const roots = [room.repoPath, room.sourceRepo, ...Object.values(room.worktrees ?? {})]
        .filter(root => typeof root === 'string' && root !== '')
        .map(root => resolve(root))
      const resolved = resolve(target)
      if (!roots.some(root => resolved === root || resolved.startsWith(`${root}${sep}`))) {
        return fail('invalid', '这个文件不在房间工作区')
      }
      if (ports.files?.exists?.(resolved) !== true) return fail('not_found', '没有这个文件')
      const buffer = ports.files.read(resolved)
      const kind = artifactKindOf(resolved)
      if (kind === 'image') {
        const max = 6 * 1024 * 1024
        if (buffer.length > max) return fail('invalid', '图片太大，先在文件夹打开')
        return ok({
          kind,
          mime: imageMimeOf(resolved),
          base64: buffer.toString('base64'),
          bytes: buffer.length,
        })
      }
      if (buffer.includes(0)) return fail('invalid', '这个文件不能直接显示')
      const max = 256 * 1024
      const text = buffer.subarray(0, max).toString('utf8')
      return ok({ kind: 'text', text, bytes: buffer.length, truncated: buffer.length > max })
    },
    workspaceMemory: ({ sourceRepo, limit = 20 } = {}) => {
      const path = typeof sourceRepo === 'string' ? sourceRepo.trim() : ''
      if (path === '') return fail('invalid', '缺少工作文件夹')
      return ok({
        entries: ports.memory?.list?.({ room: { sourceRepo: path }, limit }) ?? [],
        canReview: true,
      })
    },
    workspaceMemoryReview: ({ sourceRepo, memoryId, decision } = {}) => {
      const path = typeof sourceRepo === 'string' ? sourceRepo.trim() : ''
      if (path === '') return fail('invalid', '缺少工作文件夹')
      const result = ports.memory?.review?.({ room: { sourceRepo: path }, memoryId, decision })
      if (result?.ok !== true) {
        return fail(result?.reason === 'not_found' ? 'not_found' : result?.reason === 'invalid' ? 'invalid' : 'conflict', '没能更新房间记忆')
      }
      return ok({ entries: result.entries, canReview: true })
    },
    memory: ({ roomId, limit = 20 } = {}) => {
      const room = readRoom(roomId)
      if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
      return ok({ entries: ports.memory?.list?.({ room, limit }) ?? [], canReview: true })
    },
    forgetMemory: ({ roomId } = {}) => {
      const room = readRoom(roomId)
      if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
      const updated = updateRoom(roomId, current => {
        current.sharedMemory = []
        return { events: [{ type: 'room.memory.optout' }] }
      })
      if (updated === null) return fail('conflict', '房间状态已经变化，再试一次')
      appendMessage(roomId, { kind: 'system', text: '这间房不再参考工作区记忆。' })
      emit('room', updated)
      return ok({ room: updated })
    },
    saveProfile: saveHumanProfile,
    memoryReview: ({ roomId, memoryId, decision } = {}) => {
      const room = readRoom(roomId)
      if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
      const result = ports.memory?.review?.({ room, memoryId, decision })
      if (result?.ok !== true) {
        return fail(result?.reason === 'not_found' ? 'not_found' : result?.reason === 'invalid' ? 'invalid' : 'conflict', '没能更新房间记忆')
      }
      return ok({ entries: result.entries, canReview: true })
    },
  }
}
