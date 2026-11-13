import { fail, ok } from './result.js'

// 聊天室只有 room.chat；结论确认和继续讨论都不经过工作室的 stages/gates。
export const createServiceChat = ({ store, live, emit, dispatchPayload }) => {
  const { appendMessage, updateRoom } = store

  const accept = room => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间不在进行中')
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== 'awaiting_decision') {
      return fail('conflict', '现在没有待确认的聊天结论')
    }
    const updated = updateRoom(room.id, current => {
      current.chat = { ...current.chat, accepted: true, running: false, speaker: '' }
      current.state = 'complete'
      return { events: [{ type: 'room.complete', payload: { kind: 'chat' } }] }
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
        phase: 'discussing',
        turns: 0,
        conclusionId: null,
        accepted: false,
        running: true,
        speaker: '',
        note,
      }
      return { events: [{ type: 'chat.continued', payload: { round: current.chat.round } }] }
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

  return { accept, continue: continueChat }
}
