import { roomModeOfRoom } from '../../rooms/kinds.js'
import { accepted, created, fail, ok } from '../../result.js'
import { withAttachments } from '../../../../shared/attachments.js'
import { normalizeAttachments } from '../../attachments.js'
import { ROOM_STATE, ROUND_STATUS, STAGE_STATE } from '../../../../shared/states.js'
import { answerDecision } from '../../../../shared/decision.js'
import { leadMemberOf } from '../../room-members.js'
import { systemNotice } from '../../notices.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'

// 一轮工作的动作：开新一轮、发消息、人拍板、结束和退回。
export const createRoundActions = deps => {
  const {
    store, live, emit, roomFiles, startRound, stopRound, resumeRound, failRound, rejectRound,
    supersedeRound, humanHandoffStageOf, stages, chat, messageHandlers = {},
    recordMemory, resolveMerge, readRoom, readMessages, appendMessage, updateRound,
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
        startMessage: {
          kind: 'chat',
          authorId: 'you',
          text,
          ...(attachments.length === 0 ? {} : { meta: { attachments } }),
        },
      })
      if (result?.ok !== true) return result
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
      room = readRoom(room.id) ?? room
      const mentions = Array.isArray(body.mentions)
        ? body.mentions.filter(id => typeof id === 'string' && id !== '').slice(0, 8)
        : []
      const attachmentMeta = attachments.length === 0 ? {} : { attachments }
      const promptText = withAttachments(text, attachments)
      if (room.live === true) {
        // 停下的一轮：用户开口就是接着做——机器先把同一轮接回来，目标不动，再把话交给规划师。
        if (room.workRound?.status === ROUND_STATUS.stopped) {
          if (typeof resumeRound !== 'function') return fail('conflict', '这一轮还没法接回来')
          const resumed = resumeRound({ store, live, emit, room })
          if (resumed?.ok !== true) return fail('conflict', resumed?.error ?? '这一轮没能接回来，再试一次')
          const current = readRoom(roomId) ?? room
          if (live.isAttached?.(room.id) !== true) {
            try {
              await live.attach?.(current)
            } catch {
              return fail('conflict', '房间现在没有连上，稍后再试')
            }
          }
          const lead = leadMemberOf(current)?.id ?? null
          // 工作室的群不靠 @ 唤醒（followMentions 关着）；用户开口就直接送给规划师。
          if (roomModeOfRoom(current)?.id === 'studio' && lead !== null) {
            await live.sendToMember(room.id, lead, promptText, { intent: 'message', from: 'you' })
            return accepted({ accepted: true })
          }
          await live.send(room.id, promptText, { mentions: lead === null ? [] : [lead] })
          return accepted({ accepted: true })
        }
        if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
        if (live.busyReview(room.id)) return fail('conflict', '验收员还在看，等结论出来再继续')
        const mode = roomModeOfRoom(room)
        // 房型自己认领消息：聊天室处理叫所有人、点名和交给主持，工作室处理交给人后的重做。
        const handler = messageHandlers?.[mode?.id]
        if (typeof handler === 'function') {
          const handled = await handler(room, { text: promptText, mentions })
          if (handled !== null && handled !== undefined) return handled
        }
        // 用户用输入框回答了规划师的问题：先解除暂停，再把回答送到规划师。
        const wasQuestion = typeof room.openQuestion === 'string' && room.openQuestion.trim() !== ''
        if (wasQuestion) {
          const updated = updateRound(roomId, current => {
            current.openQuestion = null
            return { events: [] }
          })
          if (updated !== null) emit('room', updated)
        }
        const lead = wasQuestion ? leadMemberOf(room)?.id ?? null : null
        const targets = lead === null ? mentions : [...new Set([...mentions, lead])]
        // 工作室的群不靠 @ 唤醒；没有交给人时，用户的话直接交给规划师。
        const studioLead = roomModeOfRoom(room)?.id === 'studio' ? (leadMemberOf(room)?.id ?? null) : null
        if (studioLead !== null) {
          await live.sendToMember(room.id, studioLead, promptText, { intent: 'message', from: 'you' })
          return accepted({ accepted: true })
        }
        await live.send(room.id, promptText, { mentions: targets })
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

    // 规划师给的决策卡：用户选一条路，记下来并把选择送回规划师；系统不替人选。
    decision: async ({ room, readBody }) => {
      if (room.state !== ROOM_STATE.active) return fail('conflict', '房间没有在跑')
      const body = await readBody()
      const pending = room.pendingDecision
      if (pending === undefined || pending === null || pending.status !== 'open') {
        return fail('conflict', '现在没有等你决定的卡')
      }
      if (typeof body.decisionId === 'string' && body.decisionId !== '' && body.decisionId !== pending.id) {
        return fail('conflict', '这张决策卡已经过期；刷新后再选')
      }
      const result = answerDecision(
        pending,
        typeof body.optionId === 'string' ? body.optionId : '',
        Date.now(),
        typeof body.text === 'string' ? body.text : '',
      )
      if (result.error !== undefined) return fail('invalid', result.error)
      const answered = result.decision
      const updated = store.updateRound(room.id, current => {
        current.pendingDecision = answered
        return {
          events: [{
            type: 'decision.answered',
            payload: { id: answered.id, optionId: answered.answer?.optionId ?? null, status: answered.status },
          }],
        }
      })
      if (updated === null) return fail('conflict', '这张决策卡已经不在了')
      // 基座群聊仍只留规划师；等规划师排完、第一次派活时再把成员放回来。
      emit('room', store.readRoom(room.id) ?? updated)
      const chosen = answered.options?.find(option => option.id === answered.answer?.optionId)
      const written = answered.answer?.optionId === 'other' ? answered.answer?.text ?? '' : ''
      appendMessage(room.id, {
        kind: 'chat',
        authorId: 'you',
        text: answered.status === 'cancelled'
          ? '先不做这一步。'
          : written !== '' ? written : `选：${chosen?.title ?? answered.answer?.optionId}`,
      })
      if (answered.status === 'cancelled') {
        // 取消不是终点：给房间一个安静的落点，用户才知道接下来能说什么。
        systemNotice({ store, roomId: room.id, text: '这一步先不做；房间先停在这里，想换个方向直接说。' })
        return ok({ room: updated })
      }
      const lead = leadMemberOf(room)?.id ?? null
      if (lead === null) return fail('conflict', '房间里没有规划师，先加一位')
      const prompt = (written !== ''
        ? [
          `用户对「${pending.question}」没有选卡上的路，自己写的是：${written}`,
          '按用户写的这个方向继续；不要重复问同一个问题，也不要把选项再列一遍。',
        ]
        : [
          `用户对「${pending.question}」选了：${chosen?.title ?? answered.answer?.optionId}`,
          `会发生：${chosen?.effect ?? answered.answer?.effect ?? ''}`,
          '按这个方向继续；不要重复问同一个问题，也不要把选项再列一遍。',
        ]).concat([INTERNAL_PROMPT_MARKER]).join('\n')
      try {
        await live.sendToMember(room.id, lead, prompt, { intent: 'decision', from: 'you' })
      } catch {
        appendMessage(room.id, { kind: 'system', text: '选择记下了，但没能叫醒规划师；待处理。' })
      }
      return ok({ room: store.readRoom(room.id) ?? updated })
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
