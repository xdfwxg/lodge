import { randomUUID } from 'node:crypto'
import { matchEcho, seatFor } from './live-projection.js'
import { pauseForSeatFailure } from './live-sync.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from './room-chat.js'
import { toBaseMentions, toDisplayMentions } from './seat-labels.js'

// 基座回合是异步的；先把人的话落到房间里，输入框才不会看起来没反应。
// sendId 是基座的幂等键：发送响应和最终落库 ID 不同也能对上同一条话。
export const echoHumanMessage = ({ store, roomId, text, messageId, sendId }) => {
  const echo = {
    roomId,
    ts: Date.now(),
    kind: 'chat',
    authorId: 'you',
    text,
    meta: { echo: true, ...(typeof sendId === 'string' && sendId !== '' ? { sendId } : {}) },
  }
  if (typeof sendId === 'string' && sendId !== '') {
    store.upsertMessage({ ...echo, id: `optimistic:${sendId}` })
  } else if (typeof messageId === 'string' && messageId !== '') {
    store.upsertMessage({ ...echo, id: messageId })
  } else {
    store.appendMessage(roomId, echo)
  }
}

// 房间对话走基座原生群聊：成员、@、上下文和沉默都由基座负责。
// 这里只管创建/重连/收发，不把聊天变成阶段回合。
export const createRoomChat = ({ store, engine, projector, refresh, emit = () => {}, onPermission, onTurn }) => {
  const streamOf = entry => {
    if (entry.chatStreams === undefined) entry.chatStreams = new Map()
    return entry.chatStreams
  }

  const finalIdsOf = entry => {
    if (entry.chatFinalIds === undefined) entry.chatFinalIds = new Set()
    return entry.chatFinalIds
  }

  const applyDelta = (entry, room, event) => {
    const current = store.readRoom(room.id) ?? room
    if (current.roomType !== 'chat') return
    // 基座正在发言的人才是这一段 delta 的作者；自造的 speaker 只在拿不到基座状态时兜底。
    const seat = (entry.baseRoom?.busyRef === undefined ? null : seatFor(current, entry.baseRoom.busyRef))
      ?? current.chat?.speaker
    if (typeof seat !== 'string' || seat === '') return
    const streams = streamOf(entry)
    const prior = streams.get(seat)
    const id = prior?.id ?? `stream:${room.id}:${seat}`
    const existing = store.readMessages(room.id).find(message => message.id === id)
    const text = prior?.turnId === event.turnId && typeof existing?.text === 'string'
      ? existing.text + event.delta
      : event.delta
    store.upsertMessage({
      id,
      roomId: room.id,
      ts: Date.now(),
      kind: 'chat',
      authorId: seat,
      text,
      meta: { streaming: true, turnId: event.turnId ?? '' },
    })
    streams.set(seat, { id, turnId: event.turnId ?? '' })
  }

  const finishStream = (entry, room, message) => {
    if (message.kind !== 'text' && message.kind !== 'turn') return false
    const finalIds = finalIdsOf(entry)
    if (finalIds.has(message.id)) return true
    const current = store.readRoom(room.id) ?? room
    if (current.roomType !== 'chat') return false
    const seat = seatFor(current, message.authorRef) ?? current.chat?.speaker
    if (typeof seat !== 'string' || seat === '') return false
    const streams = streamOf(entry)
    const state = streams.get(seat)
    if (state === undefined) return false
    const text = message.kind === 'turn' ? message.turn?.reply : message.text
    if (typeof text !== 'string' || text.trim() === '') {
      streams.delete(seat)
      return false
    }
    const existing = store.readMessages(room.id).find(item => item.id === state.id)
    store.upsertMessage({
      ...(existing ?? { id: state.id, roomId: room.id, kind: 'chat', authorId: seat }),
      text,
      ts: message.at ?? Date.now(),
      meta: { ...(existing?.meta ?? {}), streaming: false, final: true },
    })
    streams.delete(seat)
    finalIds.add(message.id)
    return true
  }

  // 基座忙碌时消息会排队，发送响应 id 和最终落库 id 不同；回显先占位，落库后只补 baseId，不再重复投影。
  const projectMessage = (room, message) => {
    if (message.role === 'user') {
      const messages = store.readMessages(room.id)
      if (messages.some(item => item.meta?.baseId === message.id)) return null
      if (typeof message.sendId === 'string' && message.sendId !== '') {
        const echo = messages.find(item => item.meta?.sendId === message.sendId)
        if (echo !== undefined) {
          store.upsertMessage({
            ...echo,
            text: toDisplayMentions(room, message.text),
            ts: message.at ?? echo.ts,
            meta: { ...(echo.meta ?? {}), baseId: message.id },
          })
          return null
        }
      }
      const echo = matchEcho(messages, toDisplayMentions(room, message.text), message.at)
      if (echo !== undefined) {
        store.upsertMessage({ ...echo, meta: { ...(echo.meta ?? {}), baseId: message.id } })
        return null
      }
    }
    return projector.toStored(room.id, message)
  }

  const sync = async entry => {
    const room = store.readRoom(entry.roomId)
    const chat = room?.chatRoom
    if (chat === undefined) return
    const { messages } = await engine.history(chat.sessionRef)
    for (const message of messages) {
      const stored = projectMessage(room, message)
      if (stored !== null) store.upsertMessage(stored)
      pauseForSeatFailure(store, entry, message)
    }
  }

  const ensure = async room => {
    if (room.chatRoom !== undefined) {
      // 群聊默认休眠：只有被 @ 的席位才加载。工作室和聊天室都走同一条总线。
      if (typeof engine.setRoomMentions === 'function') {
        try {
          await engine.setRoomMentions(room.chatRoom.id)
        } catch (error) {
          // 基座通道正在跑回合时会拒绝改规则；规则通常已经生效，不把它当成房间错误。
          if (!/409|working or waiting/.test(String(error?.message ?? error))) {
            store.appendMessage(room.id, { kind: 'system', text: `群聊唤醒规则未启用：${error?.message ?? error}` })
          }
        }
      }
      return room
    }
    if (typeof engine.createRoom !== 'function') return room
    const members = Object.values(room.seatBots ?? {})
    if (members.length === 0) return room
    try {
      const chat = await engine.createRoom({
        name: roomChatName(room.name),
        goal: room.goal,
        bulletin: ROOM_CHAT_BULLETIN,
        members,
        cwd: room.repoPath,
        leadId: room.seatBots?.[room.leadSeat] ?? members[0],
        responder: { kind: 'mentions' },
      })
      const updated = store.updateRoom(room.id, current => {
        if (current.chatRoom !== undefined) return null
        current.chatRoom = chat
        return { events: [{ type: 'room.chat', payload: { id: chat.id } }] }
      })
      return updated ?? store.readRoom(room.id) ?? room
    } catch (error) {
      store.appendMessage(room.id, { kind: 'system', text: `房间聊天室创建失败：${error?.message ?? error}` })
      return room
    }
  }

  const subscribe = (entry, room) => {
    const chat = room.chatRoom
    if (chat === undefined) return
    entry.chat = { roomRef: chat.id, sessionRef: chat.sessionRef, unsubscribe: null }
    entry.chat.unsubscribe = engine.subscribe({
      roomId: chat.id,
      sessionRef: chat.sessionRef,
      onState: state => {
        if (!state.connected) return
        void sync(entry).catch(error => {
          store.appendMessage(room.id, { kind: 'system', text: `聊天记录同步失败：${error?.message ?? error}` })
        })
      },
      onEvent: event => {
        if (event.type === 'room') {
          entry.baseRoom = event.room
          void refresh(entry, { force: true })
          return
        }
        if (event.type === 'delta') {
          applyDelta(entry, room, event)
          void refresh(entry)
          return
        }
        const message = event.message
        if (message === undefined) return
        const current = store.readRoom(room.id) ?? room
        if (message.card?.requestType === 'permission') {
          const seat = seatFor(current, message.authorRef)
          // 工作室的群聊回合就是执行回合，权限沿用席位能力；聊天室只放行只读轻工具。
          if (current.roomType === 'studio' && typeof onPermission === 'function') {
            void onPermission(entry, seat, message, chat).catch(error => {
              store.appendMessage(room.id, { kind: 'system', text: `群聊权限卡处理失败：${error?.message ?? error}` })
            })
            return
          }
          const spec = current.seatSpecs?.find(item => item.id === seat)
          // 聊天室只放行只读轻工具；写文件、跑命令和完整执行引擎都不挂在这里。
          const allowed = message.card.action === 'read'
          void engine.answerCard({
            sessionRef: chat.sessionRef,
            requestId: message.card.requestId,
            behavior: allowed ? 'allow' : 'deny',
          }).then(() => {
            if (!allowed) {
              store.appendMessage(room.id, {
                kind: 'system',
                text: `聊天室只放行只读工具：${spec?.name ?? seat ?? '席位'} 被拒绝使用 ${message.card.tool ?? message.card.action ?? '该工具'}；要执行请新建工作室。`,
              })
            }
          }).catch(error => {
            store.appendMessage(room.id, { kind: 'system', text: `聊天权限卡处理失败：${error?.message ?? error}` })
          })
          return
        }
        if (current.roomType === 'studio' && message.kind === 'turn' && typeof onTurn === 'function') {
          onTurn(entry, current, message)
        }
        const streamed = finishStream(entry, current, message)
        if (!streamed) {
          const stored = projectMessage(current, message)
          if (stored !== null) store.upsertMessage(stored)
        }
        pauseForSeatFailure(store, entry, message)
        void refresh(entry)
      },
    })
  }

  const send = async (room, text) => {
    const chat = room.chatRoom
    if (chat === undefined) throw new Error('房间聊天室还没准备好；重连房间后再试')
    // 基座原生支持 @everyone；产品文案 @所有人 只在这里映射，不自己展开成员。
    const outgoing = toBaseMentions(room, text).split('@所有人').join('@everyone')
    const sendId = randomUUID()
    const sent = await engine.sendTurn({ roomId: chat.id, text: outgoing, sendId })
    echoHumanMessage({ store, roomId: room.id, text, messageId: sent?.messageId, sendId })
    return sent
  }

  const syncMembers = async room => {
    const chat = room.chatRoom
    if (chat === undefined || typeof engine.updateRoomMembers !== 'function') return
    const members = Object.values(room.seatBots ?? {})
    if (members.length === 0) return
    await engine.updateRoomMembers(chat.id, members)
  }

  const markRead = async room => {
    if (room.chatRoom === undefined || typeof engine.markRoomRead !== 'function') return
    await engine.markRoomRead(room.chatRoom.id)
    const updated = store.updateRoom(room.id, current => {
      if (current.chatUnread !== true) return null
      current.chatUnread = false
      return { events: [] }
    })
    if (updated !== null) emit('room', updated)
  }

  const detach = entry => {
    entry.chat?.unsubscribe?.()
    delete entry.chat
  }

  return { ensure, subscribe, send, detach, syncMembers, markRead }
}
