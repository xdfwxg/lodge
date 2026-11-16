import { fail, ok } from '../../result.js'
import { chatTransitionEvent, transitionChat } from './state.js'

// 聊天室只有 room.chat；结论确认和继续讨论都不经过工作室的 stages/gates。
export const createServiceChat = ({ store, live, emit }) => {
  const { appendMessage, readMessages, updateRoom } = store

  const accept = room => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间已经停了')
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== 'awaiting_decision') {
      return fail('conflict', '现在还没有要定的结论')
    }
    const moved = transitionChat(chat.phase, 'accept')
    if (!moved.ok) return fail('conflict', moved.error)
    const updated = updateRoom(room.id, current => {
      current.chat = { ...current.chat, phase: moved.state, running: false, speaker: '' }
      current.state = 'complete'
      return { events: [{ type: 'room.complete', payload: { kind: 'chat' } }, chatTransitionEvent(moved, 'accept', 'you', '人工认可结论')] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    emit('room', updated)
    appendMessage(room.id, { kind: 'system', text: '结论定了，房间收尾。' })
    return ok({ room: updated })
  }

  const continueChat = (room, body = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间已经停了')
    if (room.live !== true || typeof live.continueChat !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室还没有连上模型服务')
    }
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== 'awaiting_decision') {
      return fail('conflict', '现在还没有要定的结论')
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
        running: true,
        speaker: '',
        note,
      }
      return { events: [{ type: 'chat.continued', payload: { round: current.chat.round } }, chatTransitionEvent(moved, 'continue_discuss', 'you', note === '' ? '继续讨论' : note)] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    emit('room', updated)
    void live.continueChat(updated, note).catch(error => {
      appendMessage(room.id, { kind: 'system', text: `继续讨论启动失败：${error?.message ?? error}` })
      const reset = updateRoom(room.id, current => {
        if (current.chat?.running !== true) return null
        const rolled = transitionChat(current.chat.phase ?? 'discussing', 'abort')
        current.chat = { ...current.chat, running: false, speaker: '', ...(rolled.ok ? { phase: rolled.state } : {}) }
        return { events: rolled.ok ? [chatTransitionEvent(rolled, 'abort', 'system', '继续讨论启动失败')] : [] }
      })
      if (reset !== null) emit('room', reset)
    })
    return ok({ room: updated, message })
  }

  const restart = (room, body = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间已经停了')
    if (room.live !== true || typeof live.continueChat !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室还没有连上模型服务')
    }
    const chat = room.chat
    if (chat === undefined || chat.running === true) return fail('conflict', '聊天讨论已经在进行')
    if (chat.phase === 'awaiting_decision') return fail('conflict', '已经有结论了，先定下来或者继续聊')
    if (chat.phase !== 'discussing') return fail('conflict', '现在没有可恢复的讨论')
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const updated = updateRoom(room.id, current => {
      if (current.chat?.running === true) return null
      current.chat = { ...current.chat, running: true, turns: 0, speaker: '', note }
      return { events: [{ type: 'chat.resumed', payload: { round: current.chat.round ?? 1 } }] }
    })
    if (updated === null) return fail('conflict', '聊天状态已变化，重试')
    emit('room', updated)
    appendMessage(room.id, { kind: 'system', text: '刚才断了，这一轮重新开始了。' })
    void live.continueChat(updated, note).catch(error => {
      appendMessage(room.id, { kind: 'system', text: `恢复讨论失败：${error?.message ?? error}` })
      const reset = updateRoom(room.id, current => {
        if (current.chat?.running !== true) return null
        current.chat = { ...current.chat, running: false, speaker: '' }
        return { events: [] }
      })
      if (reset !== null) emit('room', reset)
    })
    return ok({ room: updated })
  }

  return { accept, continue: continueChat, restart }
}
