import { resolve, sep } from 'node:path'
import { createRealRoom } from './rooms/create/create.js'
import { created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { startRound } from './rounds/start.js'
import { failRound, rejectRound, stopRound, supersedeRound } from './rounds/lifecycle.js'
import { createRoomActions } from './actions/room-actions.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { humanHandoffStageOf } from './rooms/studio/human-handoff.js'
import { createMemberAdd } from './member-add.js'
import { createMemberRemove } from './member-remove.js'
import {
  SAMPLE_CHAT_ROOM_ID,
  SAMPLE_ROOM_ID,
  sampleChatRoomRecord,
  sampleRoomRecord,
  sampleStudioRound,
  seedSampleChatMessages,
  seedSampleMessages,
} from './rooms/sample.js'
import { artifactKindOf, imageMimeOf } from '../../shared/artifact.js'
import { systemNotice } from './notices.js'
import { cleanHumanName, setCurrentHumanName } from './human-name.js'
import { isAttachmentName, textOfFile } from './attachments.js'
import {
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_BYTES,
  attachmentNameOf,
  formatAttachmentBytes,
  isNativeImage,
  isTextFile,
} from '../../shared/attachments.js'

export { acceptanceChangeError, persistenceKind } from './service-policy.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, roles, ports, attachments = null }) => {
  const { readRoom, readMessages, writeRoom, appendMessage, updateRoom, updateRound, deleteRoom } = store
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
    if (done !== null && done !== undefined && (done.activeRoundId === null || done.activeRoundId === undefined)) {
      try { live.detach?.(done.id) } catch {}
    }
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
  // 规划师在回合里调用退回工具时，允许越过“房间还有回合在跑”的界面门禁。
  live.setRewindStage?.((roomId, request) => {
    const room = store.readRoom(roomId)
    if (room === null) return null
    return stages.rewind(room, request, { allowBusy: true })
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
    const updated = updateRound(room.id, current => {
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

  const createRoom = body => createRealRoom({ store, engine, live, emit, roles, body, ports })

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
    if (chat) {
      const created = writeRoom(sampleChatRoomRecord({ now }))
      seedSampleChatMessages({ store, room: created })
      const room = readRoom(id) ?? created
      emit('room', room)
      return ok({ room })
    }
    const sample = sampleRoomRecord({ now })
    const round = sampleStudioRound({ room: sample, now })
    const created = writeRoom({
      ...sample,
      state: 'active',
      activeRoundId: round.id,
      lastRoundId: null,
      idle: false,
    })
    store.writeWorkRound(round)
    seedSampleMessages({ store, room: created, now })
    const finalized = updateRoom(id, current => {
      current.state = 'idle'
      current.activeRoundId = null
      current.lastRoundId = round.id
      current.idle = true
      return { events: [] }
    })
    const room = readRoom(id) ?? finalized ?? created
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

  const { roomRequest } = createRoomActions({
    store,
    live,
    emit,
    attachments,
    roomFiles,
    files,
    workspace,
    startRound,
    stopRound,
    failRound,
    rejectRound,
    supersedeRound,
    humanHandoffStageOf,
    memberAdd,
    memberRemove,
    stages,
    chat,
    recordMemory,
    createRoom,
    resolveMerge,
    rememberHuman,
  })

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
