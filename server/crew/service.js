import * as log from './log.js'
import { resolve, sep } from 'node:path'
import { CHAT_PHASE, ROOM_STATE, STAGE_STATE } from '../../shared/states.js'
import { stagesCompletedOf } from '../../shared/room-status.js'
import { createRealRoom } from './rooms/create/create.js'
import { created, fail, ok } from './result.js'
import { createRoomCompleter } from './rooms/studio/plan/complete.js'
import { startRound } from './rounds/start.js'
import { reconcileCompletions } from './rounds/recovery.js'
import { failRound, rejectRound, resumeRound, stopRound, supersedeRound } from './rounds/lifecycle.js'
import { createRoomActions } from './actions/room-actions.js'
import { createPromiseRunner } from './promise/runtime.js'
import { promiseOf } from './promise/contract.js'
import { emailOf, emailWorthSending } from './promise/email.js'
import { recordPromiseDelivery } from './promise/record.js'
import { createEmailRunner } from './promise/email-runtime.js'
import {
  clearSmtpSettings,
  emailConfigError,
  emailReady,
  saveSmtpSettings,
  sendEmail,
  smtpSettingsOf,
} from './delivery/email.js'
import { createServiceQueries } from './service-queries.js'
import { createServiceChat } from './rooms/chat/service.js'
import { createServiceStages } from './rooms/studio/plan/service-stages.js'
import { humanHandoffStageOf } from './rooms/studio/delivery/human-handoff.js'
import { createMemberAdd } from './member-add.js'
import { createPlanApplier } from './rooms/studio/plan/apply-plan.js'
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
import { alreadyReceived, normalizeWebhookEvent, verifyWebhookToken, webhookPathOf } from './webhook.js'
import { plainRuntimeError } from './base-error.js'
import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
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
  setCurrentHumanName(profile.name)

  const queries = createServiceQueries({
    store,
    engine,
    roles,
    roomFiles,
    files,
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
    if (!stagesCompletedOf(room)) return
    try {
      const result = ports.memory?.appendRoom?.({ room: memoryRoom(room), messages: readMessages(room.id) })
      if (result?.ok === false && result.reason !== 'demo' && result.reason !== 'no-workspace') {
        log.warn(`[lodge] 房间记忆没有写入：${result.reason}`)
      }
    } catch (error) {
      log.warn(`[lodge] 房间记忆没有写入：${error?.message ?? error}`)
    }
  }
  const readTextArtifact = (room, path) => {
    try {
      if (typeof path !== 'string' || path === '') return ''
      if (!['document', 'text'].includes(artifactKindOf(path))) return ''
      const roots = [room.repoPath, ...Object.values(room.worktrees ?? {})]
        .filter(root => typeof root === 'string' && root !== '')
        .map(root => root.replace(/\/$/, ''))
      if (!roots.some(root => path === root || path.startsWith(`${root}/`))) return ''
      if (ports.files?.exists?.(path) !== true) return ''
      return String(ports.files.read(path)).slice(0, 200_000)
    } catch {
      return ''
    }
  }
  // 一轮交付后，如果这间房说好要发邮箱，平台把结果排进同一个队列；不阻塞收口。
  const queuePromiseEmail = done => {
    if (done === null || done === undefined) return
    const promise = promiseOf(done)
    if (promise === null || promise.status !== 'active') return
    if (promise.delivery?.channel !== 'email') return
    if (emailWorthSending(promise) !== true) {
      store.appendMessage?.(done.id, {
        kind: 'system',
        text: '这次和上次一样，没有发邮件。',
        meta: { kind: 'notice', show: true },
      })
      return
    }
    const roundId = done.workRound?.id ?? done.lastRoundId ?? null
    const payload = emailOf({
      room: done,
      promise,
      roundId,
      messages: readMessages(done.id),
      readArtifact: path => readTextArtifact(done, path),
    })
    if (payload.to === '' || payload.text.trim() === '') return
    const id = `email.send:${done.id}:${roundId ?? 'latest'}`
    store.enqueueWork?.({
      id,
      roomId: done.id,
      kind: 'email.send',
      payload,
      dedupeKey: id,
      availableAt: 0,
      maxAttempts: 3,
    })
  }
  const finishRoom = createRoomCompleter({ store, emit, roomFiles, workspace }).completeRoom
  const completeRoom = room => {
    const done = finishRoom(room)
    if (done !== null && done !== undefined && (done.activeRoundId === null || done.activeRoundId === undefined)) {
      try { live.detach?.(done.id) } catch {}
    }
    recordMemory(done)
    const recorded = recordPromiseDelivery({
      store,
      room: done,
      messages: readMessages(done.id),
      readArtifact: path => readTextArtifact(done, path),
    })
    if (recorded !== null) emit('room', recorded)
    queuePromiseEmail(recorded ?? done)
    return done
  }
  const stages = createServiceStages({ store, live, emit, completeRoom, roomFiles, workspace: ports.workspace })
  // 规划师对齐回合结束后由实时层回调：对齐这一步没有界面动作，自动确认后继续。
  live.setConfirmStage?.((roomId, index, options = {}) => {
    const room = store.readRoom(roomId)
    if (room === null) return null
    return stages.accept(room, { stage: index, ...options })
  })
  // 规划师在回合里调用退回工具时，允许越过“房间还有回合在跑”的界面门禁。
  live.setRewindStage?.((roomId, request) => {
    const room = store.readRoom(roomId)
    if (room === null) return null
    return stages.rewind(room, request, { allowBusy: true })
  })
  // 用户说停时，规划师用停止工具把这一轮真的停住；用户看不到任何系统动作。
  live.setStopRound?.((roomId, request) => {
    const room = store.readRoom(roomId)
    if (room === null) return null
    return stopRound({ store, live, emit, room, reason: request?.reason ?? '' })
  })
  // 用户的意思是接着做时，规划师把同一轮接回来；接回后叫醒它继续，目标不改。
  live.setResumeRound?.((roomId) => {
    const room = store.readRoom(roomId)
    if (room === null) return null
    const result = resumeRound({ store, live, emit, room })
    if (result.ok !== true) return result
    const resumed = result.body?.room ?? store.readRoom(roomId) ?? room
    const lead = (resumed.members ?? []).find(member => member.role === 'lead' || member.roleKind === 'planner')?.id
    const stages = Array.isArray(resumed.stages) ? resumed.stages : []
    const index = stages.findIndex(stage => stage.state === STAGE_STATE.active)
    if (typeof lead === 'string' && lead !== '') {
      void live.sendToMember(roomId, lead, [
        '这一轮已经接回来，接着做，不要重复已经说过的计划。',
        `目标：${resumed.goal ?? ''}`,
        index >= 0 ? `从第 ${index + 1} 步「${stages[index].title}」继续。` : '',
        '说清下一步和交给谁。',
        INTERNAL_PROMPT_MARKER,
      ].filter(Boolean).join('\n'), { intent: 'resume' }).catch(error => {
        log.warn(`resume wake failed: ${roomId} ${error?.message ?? error}`)
      })
    }
    return result
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
    desktopMcp: ports.desktopMcp ?? null,
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
      state: ROOM_STATE.active,
      activeRoundId: round.id,
      lastRoundId: null,
      idle: false,
    })
    store.writeWorkRound(round)
    seedSampleMessages({ store, room: created, now })
    const finalized = updateRoom(id, current => {
      current.state = ROOM_STATE.idle
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

  live.setApplyPlan?.(createPlanApplier({
    store,
    engine,
    live,
    emit,
    memberAdd,
    memberRemove,
    sendToMember: (roomId, memberId, text) => live.sendToMember?.(roomId, memberId, text, { intent: 'align' }),
  }))
  live.setAdjustModel?.((roomId, request) => {
    const room = store.readRoom(roomId)
    if (room === null) return
    const member = (room.members ?? []).find(item => item.id === request.member || item.name === request.member)
    if (member === undefined) {
      systemNotice({ store, roomId, text: `没有找到成员 ${request.member}。` })
      return
    }
    return Promise.resolve(live.swapBody(room, { memberId: member.id, engine: request.engine, model: request.model }))
      .then(result => {
        if (result?.ok !== true) {
          systemNotice({ store, roomId, text: `换模型没成功：${result?.error ?? '再试一次'}` })
          return
        }
        store.appendMessage(roomId, { kind: 'system', text: `${member.name} 换成了 ${request.model}。` })
      })
  })
  live.setPromiseRunner?.(createPromiseRunner({ store, live, emit, startRound, roomFiles }))
  live.setEmailRunner?.(createEmailRunner({ store, emit }))

  const { roomRequest } = createRoomActions({
    store,
    engine,
    live,
    emit,
    attachments,
    roomFiles,
    files,
    workspace,
    startRound,
    emailReady,
    stopRound,
    resumeRound,
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
  })

  const emailSettings = () => ok({ settings: smtpSettingsOf() })
  const saveEmailSettings = input => {
    const saved = saveSmtpSettings(input)
    if (saved.error !== undefined) return fail('invalid', saved.error)
    return ok({ settings: saved.settings })
  }
  const clearEmailSettings = () => ok({ settings: clearSmtpSettings().settings })
  const testEmail = async input => {
    const settings = smtpSettingsOf()
    // 测试邮件默认发给自己；收件邮箱只在想发到别处时才填。
    const to = String(input?.to ?? '').trim() || settings.to || settings.from || ''
    if (to === '') return fail('invalid', '填一个收件邮箱')
    const problem = emailConfigError()
    if (problem !== '') return fail('unavailable', problem)
    try {
      const sent = await sendEmail({
        to,
        subject: 'Lodge 邮件连接测试',
        text: '这封是 Lodge 的 SMTP 连接测试。收到它，说明邮箱已经接上；可以回房间把承诺设成「发到邮箱」。',
      })
      return ok({ to, id: sent.id })
    } catch (error) {
      return fail('upstream', `没发出去：${plainRuntimeError(error)}`)
    }
  }

  // 外部事件入口：令牌对、房间在、按 id 幂等；落一条外部消息后，聊天室照常接话，工作室只记消息。
  const webhookReceive = async (roomId, token, body) => {
    const room = store.readRoom(roomId)
    if (room === null) return fail('not_found', '没有这个房间')
    if (webhookPathOf(room) === null) return fail('not_found', '这个房间没有开 webhook')
    if (!verifyWebhookToken(room, token)) return fail('forbidden', 'webhook 令牌不对')
    const event = normalizeWebhookEvent(body)
    if (event.error !== undefined) return fail('invalid', event.error)
    const recent = store.readRecentMessages(roomId, 200)
    if (alreadyReceived(recent, event.id)) return ok({ accepted: true, duplicate: true, id: event.id })
    store.appendMessage(roomId, {
      kind: 'chat',
      authorId: 'webhook',
      text: event.text,
      meta: { kind: 'webhook', webhookId: event.id },
    })
    // 只有聊天室会因此开口；工作室不因为外部事件自己开工，人仍然决定要不要开始。
    // 讨论已经收口时再开一轮（不写“再讨论一轮”那种人话，事件本身就是由头）；
    // 还没收口就让在跑的这一轮自己看到时间线里的新消息。
    if (room.roomType === 'chat') {
      try {
        if (room.chat?.phase === CHAT_PHASE.concluded) {
          const continued = chat.continue(room, { note: '' }, { recordNote: false })
          // 接着聊失败（没连上模型、额度用完）不能说成“房间看到了”：事件留着，原因也写出来。
          if (continued?.ok === false) {
            store.appendMessage(roomId, {
              kind: 'system',
              text: `外部事件已经到了，但房间没有接着聊：${continued.error ?? '连不上模型服务'}`,
            })
          }
        } else if (room.chat === undefined) {
          await roomRequest(roomId, 'messages', { method: 'POST', readBody: async () => ({ text: '' }) })
        }
      } catch (error) {
        store.appendMessage(roomId, { kind: 'system', text: `外部事件已经到了，但房间没有接着聊：${String(error?.message ?? error).slice(0, 120)}` })
      }
    }
    emit('room', store.readRoom(roomId) ?? room)
    return ok({ accepted: true, id: event.id })
  }

  return {
    ...queries,
    createRoom,
    webhookReceive,
    createSampleRoom,
    roomRequest,
    emailSettings,
    saveEmailSettings,
    clearEmailSettings,
    testEmail,
    reconcileCompletion: () => reconcileCompletions({ store, completeRoom }),
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
