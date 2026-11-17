import { hostAddress } from '../../member-labels.js'
import { memberOf } from '../../room-members.js'

// 聊天调度只认这个端口：历史、回复和空闲判断都留在适配层。
export const createChatTransport = ({ engine, store, roomId }) => {
  const current = () => store.readRoom(roomId)
  const sessionRefOf = () => current()?.chatRoom?.sessionRef

  const messagesOf = async () => {
    const sessionRef = sessionRefOf()
    if (typeof sessionRef !== 'string' || sessionRef === '') return null
    const { messages } = await engine.history(sessionRef, { limit: 1000 })
    return messages
  }

  return {
    ready: () => typeof sessionRefOf() === 'string' && sessionRefOf() !== '',
    messageIds: async () => {
      const messages = await messagesOf()
      return new Set((messages ?? []).map(message => message.id))
    },
    findReply: async (memberId, before) => {
      const room = current()
      if (room === null) return null
      const ref = memberId === 'host'
        ? hostAddress(room)?.memberRef
        : memberOf(room, memberId)?.body?.ref
      if (typeof ref !== 'string' || ref === '') return null
      try {
        const messages = await messagesOf()
        if (messages === null) return null
        const hit = messages.find(message => (
          !before.has(message.id) &&
          message.authorRef === ref &&
          (message.kind === 'text' || (message.kind === 'turn' && message.turn?.reply))
        ))
        return hit === undefined ? null : { text: hit.turn?.reply ?? hit.text ?? '' }
      } catch {
        return null
      }
    },
    isIdle: async () => {
      const chatId = current()?.chatRoom?.id
      if (typeof chatId !== 'string' || chatId === '') return true
      try {
        const rooms = await engine.rooms()
        const room = rooms.find(item => item.id === chatId)
        return room === undefined || room.working !== true
      } catch {
        return true
      }
    },
  }
}
