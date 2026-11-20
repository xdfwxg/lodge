import { fail, ok } from '../../result.js'
import { chatTransitionEvent, transitionChat } from './state.js'
import { systemNotice } from '../../notices.js'

// 聊天室只有 room.chat；结论之后继续聊，不经过工作室的 stages/gates，也不需要确认。
export const createServiceChat = ({ store, live, emit }) => {
  const { appendMessage, readMessages, updateRoom } = store

  const continueChat = (room, body = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== 'active') return fail('conflict', '房间已经停了')
    if (room.live !== true || typeof live.continueChat !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室还没有连上模型服务')
    }
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== 'concluded') {
      return fail('conflict', '现在还没有结论可以接着聊')
    }
    const event = 'continue_discuss'
    const moved = transitionChat(chat.phase, event)
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
      return { events: [{ type: 'chat.continued', payload: { round: current.chat.round } }, chatTransitionEvent(moved, event, 'you', note === '' ? '继续讨论' : note)] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    emit('room', updated)
    void live.continueChat(updated, note, { speakerIds: body.speakerIds }).catch(error => {
      systemNotice({ store, roomId: room.id, text: '没能继续讨论；稍后再试。', error })
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
      systemNotice({ store, roomId: room.id, text: '没能恢复讨论；稍后再试。', error })
      const reset = updateRoom(room.id, current => {
        if (current.chat?.running !== true) return null
        current.chat = { ...current.chat, running: false, speaker: '' }
        return { events: [] }
      })
      if (reset !== null) emit('room', reset)
    })
    return ok({ room: updated })
  }

  const setHostThinking = (room, value) => {
    const updated = updateRoom(room.id, current => {
      if (current.chat === undefined) return null
      current.chat = { ...current.chat, hostThinking: value }
      return { events: [] }
    })
    if (updated !== null) emit('room', updated)
  }

  const input = async (room, body = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.live !== true || typeof live.hostIntent !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室还没有连上模型服务')
    }
    const text = typeof body.note === 'string' ? body.note.trim().slice(0, 8000) : ''
    if (text === '') return fail('invalid', '消息不能为空')
    let intent
    setHostThinking(room, true)
    try {
      intent = await live.hostIntent(room, text)
    } catch (error) {
      return fail('conflict', String(error?.message ?? error))
    } finally {
      setHostThinking(room, false)
    }
    // Lodge 判断要开房：把判断交回给房间动作，由它建工作室或聊天室并留记录。
    if (intent.action === 'open') return ok({ room, intent })
    if (intent.action === 'round') {
      const result = continueChat(room, { note: text, speakerIds: intent.speakers })
      if (result.ok !== true) return result
      if (intent.reply !== '') appendMessage(room.id, { kind: 'chat', authorId: 'lodge', text: intent.reply })
      return result
    }
    const message = appendMessage(room.id, { kind: 'chat', authorId: 'lodge', text: intent.reply })
    return ok({ room, message })
  }

  return { continue: continueChat, input, restart }
}
