import { fail, ok } from '../../result.js'
import { withAttachments } from '../../../../shared/attachments.js'
import { normalizeAttachments } from '../../attachments.js'
import { ROOM_STATE } from '../../../../shared/states.js'

// Lodge 的对话：一句话决定开工作室还是留下聊聊，不出现房型选择。
export const createLodgeActions = deps => {
  const { chat, createRoom, readRoom, appendMessage, emit } = deps

  return {
    lodge: async ({ room: input, readBody }) => {
      let room = input
      if (room.lodge !== true) return fail('invalid', '这不是 Lodge 对话')
      if (room.state !== ROOM_STATE.active) return fail('conflict', 'Lodge 现在没有在运行')
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 8000) : ''
      const normalized = normalizeAttachments(body.attachments)
      if (normalized.error !== undefined) return fail('invalid', normalized.error)
      const attachments = normalized.attachments
      if (text === '' && attachments.length === 0) return fail('invalid', '说一句想做什么')
      room = readRoom(room.id) ?? room
      const userMessage = appendMessage(room.id, {
        kind: 'chat',
        authorId: 'you',
        text,
        ...(attachments.length === 0 ? {} : { meta: { attachments } }),
      })
      if (room.live !== true || deps.live.isAttached?.(room.id) !== true) {
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
      // 目标优先用主持从上下文里整理出的 goal；最后一句常常只是“找人一起评”这类动作。
      const goalText = decision.goal || (text === '' ? (attachments[0]?.title ?? '看看这个附件') : text)
      const created = await createRoom({
        goal: withAttachments(goalText, attachments),
        name: goalText.slice(0, 24),
        verify: 'manual',
        sourceRoomId: room.id,
        sourceName: room.name ?? '',
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
          },
        }),
      })
      emit('room', readRoom(room.id) ?? room)
      return ok({ room: readRoom(room.id) ?? room, createdRoom })
    },
  }
}
