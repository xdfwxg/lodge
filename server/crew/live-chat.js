import { seatFor } from './live-projection.js'
import { decidePermission } from './permission.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from './room-chat.js'
import { toBaseMentions } from './seat-labels.js'

// 基座回合是异步的；先把人的话落到房间里，输入框才不会看起来没反应。
export const echoHumanMessage = ({ store, roomId, text, messageId }) => {
  const echo = { roomId, ts: Date.now(), kind: 'chat', authorId: 'you', text }
  if (typeof messageId === 'string' && messageId !== '') {
    store.upsertMessage({ ...echo, id: messageId })
  } else {
    store.appendMessage(roomId, echo)
  }
}

// 房间对话走基座原生群聊：成员、@、上下文和沉默都由基座负责。
// 这里只管创建/重连/收发，不把聊天变成阶段回合。
export const createRoomChat = ({ store, engine, projector, refresh, emit = () => {} }) => {
  const sync = async entry => {
    const room = store.readRoom(entry.roomId)
    const chat = room?.chatRoom
    if (chat === undefined) return
    const { messages } = await engine.history(chat.sessionRef)
    for (const message of messages) {
      const stored = projector.toStored(room.id, message)
      if (stored !== null) store.upsertMessage(stored)
    }
  }

  const ensure = async room => {
    if (room.chatRoom !== undefined) {
      // 旧聊天群可能还是固定规划师；补成自动选人，失败就继续用现有 responder。
      if (typeof engine.setRoomAutoRoute === 'function') {
        try {
          await engine.setRoomAutoRoute(room.chatRoom.id, room.seatBots?.[room.leadSeat])
        } catch (error) {
          store.appendMessage(room.id, { kind: 'system', text: `聊天自动选人未启用：${error?.message ?? error}` })
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
        autoRoute: true,
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
        if (state.connected) void sync(entry)
      },
      onEvent: event => {
        if (event.type === 'room') {
          void refresh(entry, { force: true })
          return
        }
        const message = event.message
        if (message === undefined) return
        // 聊天只读：允许读，拒绝写/执行；聊天回合不产出交付，也不该改文件。
        if (message.card?.requestType === 'permission') {
          const seat = seatFor(store.readRoom(room.id), message.authorRef)
          const spec = room.seatSpecs?.find(item => item.id === seat)
          const allowed = decidePermission(spec, message.card.action, { readOnly: true })
          void engine.answerCard({
            sessionRef: chat.sessionRef,
            requestId: message.card.requestId,
            behavior: allowed ? 'allow' : 'deny',
          }).then(() => {
            if (!allowed) {
              store.appendMessage(room.id, {
                kind: 'system',
                text: `聊天只读：${spec?.name ?? seat ?? '席位'} 不能使用 ${message.card.tool ?? message.card.action ?? '该工具'}；执行请在阶段里派活。`,
              })
            }
          }).catch(error => {
            store.appendMessage(room.id, { kind: 'system', text: `聊天权限卡处理失败：${error?.message ?? error}` })
          })
          return
        }
        const stored = projector.toStored(room.id, message)
        if (stored !== null) store.upsertMessage(stored)
        void refresh(entry)
      },
    })
  }

  const send = async (room, text) => {
    const chat = room.chatRoom
    if (chat === undefined) throw new Error('房间聊天室还没准备好；重连房间后再试')
    const handles = Object.values(room.seatNames ?? {})
      .filter(name => typeof name === 'string' && name !== '')
      .map(name => `@${name}`)
      .join(' ')
    const outgoing = toBaseMentions(room, text).split('@所有人').join(handles)
    const sent = await engine.sendTurn({ roomId: chat.id, text: outgoing })
    echoHumanMessage({ store, roomId: room.id, text, messageId: sent?.messageId })
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
