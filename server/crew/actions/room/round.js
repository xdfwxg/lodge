import { roomModeOfRoom } from '../../rooms/kinds.js'
import { accepted, created, fail } from '../../result.js'
import { withAttachments } from '../../../../shared/attachments.js'
import { normalizeAttachments } from '../../attachments.js'
import { ROOM_STATE, STAGE_STATE } from '../../../../shared/states.js'

// 一轮工作的动作：开新一轮、发消息、人拍板、结束和退回。
export const createRoundActions = deps => {
  const {
    store, live, emit, roomFiles, startRound, stopRound, failRound, rejectRound,
    supersedeRound, humanHandoffStageOf, stages, chat, recordMemory, resolveMerge,
    rememberHuman, readRoom, readMessages, appendMessage, updateRound,
  } = deps

  return {
    // 已交付的房间里说一句要改什么：在同一个工作间开下一轮，不新建房间。
    rounds: async ({ room: input, readBody }) => {
      let room = input
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
    },

    messages: async ({ roomId, room: input, readBody }) => {
      let room = input
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
        const policy = mode?.messagePolicy?.({ room, text, messages, mentions }) ?? null
        // 规划师已经把这步交给人：人的这句话就是补充上下文，直接重跑这一步。
        if (policy?.type === 'human-rework') {
          const result = await stages.rework(room, { stage: policy.stage, note: promptText })
          if (result.ok !== true) return result
          return accepted({ room: result.body?.room ?? readRoom(room.id) })
        }
        // 不带 @：用户在跟主持说话；带 @：直接交给被点名的成员。
        if (policy?.type === 'host') return chat.input(room, { note: promptText })
        // 结论后叫所有人：开一轮受轮次和配额限制的讨论。
        if (policy?.type === 'round') {
          return chat.continue(room, {
            note: promptText,
            speakerIds: (room.members ?? []).map(member => member.id),
          })
        }
        const direct = mode?.id === 'chat'
          ? mentions
            .map(id => (room.members ?? []).find(member => member.id === id)?.name)
            .filter(name => typeof name === 'string' && name !== '')
          : []
        await live.send(room.id, promptText, {
          mentions,
          ...(direct.length === 0 ? {} : { meta: { direct } }),
        })
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text, ...(attachments.length === 0 ? {} : { meta: attachmentMeta }) })
      const demoMessage = roomModeOfRoom(room)?.demoMessage
      if (room.demo === true && typeof demoMessage === 'string' && demoMessage !== '') {
        appendMessage(roomId, { kind: 'system', text: demoMessage })
      }
      const active = room.stages.find(stage => stage.state === STAGE_STATE.active)
      if (room.openQuestion !== null && active?.kind === 'decision') {
        const updated = updateRound(roomId, current => {
          current.openQuestion = null
          return { events: [] }
        })
        if (updated !== null) emit('room', updated)
      }
      return created({ message })
    },

    'human-choice': async ({ roomId, room, readBody }) => {
      if (room.state !== ROOM_STATE.active) return fail('conflict', '房间没有在跑')
      const body = await readBody()
      const stage = Number(body.stage)
      const choice = body.choice === 'accept' ? 'accept' : body.choice === 'rework' ? 'rework' : ''
      if (choice === '') return fail('invalid', '选择只能是接受或重做')
      const handoff = humanHandoffStageOf(room, readMessages(room.id))
      if (handoff !== stage) return fail('conflict', '这一步没有等你决定')
      if (choice === 'accept') {
        const result = await stages.accept(room, { stage, force: true })
        if (result.ok === true) recordMemory(result.body?.room ?? readRoom(roomId))
        return result
      }
      return stages.rework(room, {
        stage,
        note: typeof body.note === 'string' ? body.note : '',
      })
    },

    accept: async ({ room, readBody }) => {
      const result = await stages.accept(room, await readBody())
      if (result.ok === true) recordMemory(result.body?.room ?? readRoom(room.id))
      return result
    },

    'chat-continue': async ({ room, readBody }) => chat.continue(room, await readBody()),
    'chat-resume': async ({ room, readBody }) => chat.restart(room, await readBody()),

    'reject-plan': async ({ room, readBody }) => {
      const body = await readBody()
      return rejectRound({
        store,
        live,
        emit,
        room,
        reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '',
      })
    },

    'stop-round': async ({ room, readBody }) => {
      const body = await readBody()
      return stopRound({
        store,
        live,
        emit,
        room,
        reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '',
      })
    },

    'fail-round': async ({ room, readBody }) => {
      const body = await readBody()
      return failRound({
        store,
        live,
        emit,
        room,
        reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : '',
      })
    },

    'supersede-round': async ({ room, readBody }) => supersedeRound({
      store,
      live,
      emit,
      room,
      body: await readBody(),
      roomFiles,
    }),

    'resolve-merge': async ({ room }) => resolveMerge(room),
    rework: async ({ room, readBody }) => stages.rework(room, await readBody()),
    retry: async ({ room, readBody }) => stages.retry(room, await readBody()),
    rewind: async ({ room, readBody }) => stages.rewind(room, await readBody()),
  }
}
