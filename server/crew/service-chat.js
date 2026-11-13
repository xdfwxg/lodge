import { fail, ok } from './result.js'
import { chatTransitionEvent, transitionChat } from './room-state.js'

// 聊天室只有 room.chat；结论确认和继续讨论都不经过工作室的 stages/gates。
export const createServiceChat = ({ store, live, emit, dispatchPayload }) => {
  const { appendMessage, readMessages, updateRoom } = store

  const accept = room => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间不在进行中')
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== 'awaiting_decision') {
      return fail('conflict', '现在没有待确认的聊天结论')
    }
    const moved = transitionChat(chat.phase, 'accept')
    if (!moved.ok) return fail('conflict', moved.error)
    const updated = updateRoom(room.id, current => {
      current.chat = { ...current.chat, phase: moved.state, accepted: true, running: false, speaker: '' }
      current.state = 'complete'
      return { events: [{ type: 'room.complete', payload: { kind: 'chat' } }, chatTransitionEvent(moved, 'accept', 'you', '人工认可结论')] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    appendMessage(room.id, { kind: 'system', text: '聊天结论已确认，房间完成。' })
    return ok({ room: updated })
  }

  const continueChat = (room, body = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间不在进行中')
    if (room.live !== true || typeof live.continueChat !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室没有绑定运行引擎')
    }
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== 'awaiting_decision') {
      return fail('conflict', '现在没有待确认的聊天结论')
    }
    const moved = transitionChat(chat.phase, 'continue_discuss')
    if (!moved.ok) return fail('conflict', moved.error)
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const message = appendMessage(room.id, {
      kind: 'chat_rework',
      authorId: 'you',
      text: note === '' ? '再讨论一轮。' : note,
      meta: { round: chat.round ?? 1, phase: chat.phase },
    })
    const updated = updateRoom(room.id, current => {
      current.chat = {
        ...current.chat,
        round: (current.chat.round ?? 1) + 1,
        phase: moved.state,
        turns: 0,
        conclusionId: null,
        accepted: false,
        running: true,
        speaker: '',
        note,
      }
      return { events: [{ type: 'chat.continued', payload: { round: current.chat.round } }, chatTransitionEvent(moved, 'continue_discuss', 'you', note === '' ? '继续讨论' : note)] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    void live.continueChat(updated, note).catch(error => {
      appendMessage(room.id, { kind: 'system', text: `继续讨论启动失败：${error?.message ?? error}` })
      const reset = updateRoom(room.id, current => {
        if (current.chat?.running !== true) return null
        current.chat = { ...current.chat, running: false, speaker: '', phase: 'discussing' }
        return { events: [] }
      })
      if (reset !== null) emit('room', reset)
    })
    return ok({ room: updated, message })
  }

  const snapshot = room => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    const messages = readMessages(room.id)
      .filter(message => ['chat', 'chat_rework', 'chat_conclusion'].includes(message.kind))
      .map(message => ({
        kind: message.kind,
        authorId: message.authorId,
        text: message.text,
        ...(message.meta?.round === undefined ? {} : { round: message.meta.round }),
      }))
    const conclusion = [...readMessages(room.id)].reverse().find(message => message.kind === 'chat_conclusion')
    return ok({
      snapshot: {
        roomId: room.id,
        name: room.name,
        goal: room.goal,
        round: room.chat?.round ?? 1,
        turnLimit: room.chat?.turnLimit ?? 6,
        accepted: room.chat?.accepted === true,
        conclusion: conclusion === undefined
          ? null
          : { text: conclusion.text, round: conclusion.meta?.round ?? 1, fallback: conclusion.meta?.fallback === true },
        messages,
        exportedAt: new Date().toISOString(),
      },
    })
  }

  return { accept, continue: continueChat, snapshot }
}
