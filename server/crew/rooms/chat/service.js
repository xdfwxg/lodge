import { fail, ok } from '../../result.js'
import { chatTransitionEvent, transitionChat } from './state.js'
import { systemNotice } from '../../notices.js'
import { CHAT_PHASE, ROOM_STATE } from '../../../../shared/states.js'
import { chatModeOf } from '../../../../shared/room-status.js'
import { MENTION_ALL } from '../../../../shared/mentions.js'

// 聊天室只有 room.chat；结论之后继续聊，不经过工作室的 stages/gates，也不需要确认。
const chatBudgetExceeded = room => {
  const budget = Number(room?.usage?.budgetMicroUsd ?? room?.budgetMicroUsd ?? 0)
  if (!Number.isFinite(budget) || budget <= 0) return false
  if (room?.usage?.costStatus === 'unknown') return false
  return (Number(room?.usage?.costMicroUsd) || 0) >= budget
}

export const createServiceChat = ({ store, live, emit }) => {
  const { appendMessage, readMessages, updateRoom } = store

  const continueChat = (room, body = {}, { recordNote = true } = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== ROOM_STATE.active) return fail('conflict', '房间已经停了')
    if (room.live !== true || typeof live.continueChat !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室还没有连上模型服务')
    }
    if (chatBudgetExceeded(room)) {
      return fail('conflict', '这一轮的额度用完了；先停下，等你决定要不要继续。')
    }
    const chat = room.chat
    if (chat === undefined || chat.running === true || chat.phase !== CHAT_PHASE.concluded) {
      return fail('conflict', '现在还没有结论可以接着聊')
    }
    const event = 'continue_discuss'
    const moved = transitionChat(chat.phase, event)
    if (!moved.ok) return fail('conflict', moved.error)
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    // 用户消息已经由调用方落库时不再写第二条；chat-rework 只用于“再讨论一轮”这个动作。
    const message = recordNote
      ? appendMessage(room.id, {
        kind: 'chat_rework',
        authorId: 'you',
        text: note === '' ? '再讨论一轮。' : note,
        meta: { round: chat.round ?? 1, phase: chat.phase },
      })
      : null
    const updated = updateRoom(room.id, current => {
      current.chat = {
        ...current.chat,
        round: (current.chat.round ?? 1) + 1,
        phase: moved.state,
        turns: 0,
        conclusionId: null,
        running: true,
        interrupted: false,
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
        return { events: rolled.ok ? [chatTransitionEvent(rolled, 'abort', 'system', '这次没能继续讨论，再试一次')] : [] }
      })
      if (reset !== null) emit('room', reset)
    })
    return ok({ room: updated, message })
  }

  const restart = (room, body = {}) => {
    if (room.roomType !== 'chat') return fail('invalid', '不是聊天室')
    if (room.state !== ROOM_STATE.active) return fail('conflict', '房间已经停了')
    if (room.live !== true || typeof live.continueChat !== 'function' || live.isAttached?.(room.id) !== true) {
      return fail('conflict', '聊天室还没有连上模型服务')
    }
    if (chatBudgetExceeded(room)) {
      return fail('conflict', '这一轮的额度用完了；先停下，等你决定要不要继续。')
    }
    const chat = room.chat
    if (chat === undefined || chat.running === true) return fail('conflict', '聊天讨论已经在进行')
    if (chat.phase !== CHAT_PHASE.discussing) return fail('conflict', '现在没有可恢复的讨论')
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const updated = updateRoom(room.id, current => {
      if (current.chat?.running === true) return null
      current.chat = {
        ...current.chat,
        running: true,
        interrupted: false,
        // 从已经说完的次数续跑，不把这一轮从第一句重来。
        turns: current.chat.turns ?? 0,
        speaker: '',
        note,
      }
      return { events: [{ type: 'chat.resumed', payload: { round: current.chat.round ?? 1 } }] }
    })
    if (updated === null) return fail('conflict', '聊天状态已变化，重试')
    emit('room', updated)
    appendMessage(room.id, { kind: 'system', text: '接着这一轮继续，已经说过的话都还在。' })
    void live.continueChat(updated, note, { resume: true }).catch(error => {
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
      const result = continueChat(room, { note: text, speakerIds: intent.speakers }, { recordNote: false })
      if (result.ok !== true) return result
      if (intent.reply !== '') appendMessage(room.id, { kind: 'chat', authorId: 'lodge', text: intent.reply })
      return result
    }
    const message = appendMessage(room.id, { kind: 'chat', authorId: 'lodge', text: intent.reply })
    return ok({ room, message })
  }

  // 用户消息先由聊天室自己认领：叫所有人、点名、还是交给主持。
  // 通用房间动作只负责把 live 房间的消息送到这里，不再认识聊天策略。
  const handleMessage = async (room, { text = '', mentions = [] } = {}) => {
    const value = String(text ?? '').trim().slice(0, 8000)
    // 用户的话先落进房间；主持的回复、开轮和点名都只是它之后的动作。
    if (value !== '') appendMessage(room.id, { kind: 'chat', authorId: 'you', text: value })
    const mode = chatModeOf(room)
    if (mentions.includes(MENTION_ALL)) {
      return mode === 'open'
        ? continueChat(room, { note: value, speakerIds: (room.members ?? []).map(member => member.id) }, { recordNote: false })
        : fail('conflict', '这一轮还在讨论，等结论出来再叫所有人。')
    }
    const named = mentions.filter(id => (room.members ?? []).some(member => member.id === id))
    if (named.length > 0) {
      if (mode === 'round') return fail('conflict', '这一轮还在讨论，等结束再点名；着急就先叫停。')
      const names = named
        .map(id => (room.members ?? []).find(member => member.id === id)?.name)
        .filter(name => typeof name === 'string' && name !== '')
      await live.send(room.id, value, {
        mentions: named,
        ...(names.length === 0 ? {} : { meta: { direct: names } }),
      })
      return ok({ accepted: true })
    }
    return input(room, { note: value })
  }

  return { continue: continueChat, handleMessage, input, restart }
}
