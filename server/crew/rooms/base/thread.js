// 基座群聊的只读窗口：谁说了什么、房间有没有在忙。
// 聊天主持和影子评审都从这里取话，不再各写一套轮询。
export const createBaseThread = ({ engine, store, roomId }) => {
  const room = () => store.readRoom(roomId)
  const sessionRefOf = () => room()?.chatRoom?.sessionRef
  const messagesOf = async () => {
    const sessionRef = sessionRefOf()
    if (typeof sessionRef !== 'string' || sessionRef === '') return null
    const { messages } = await engine.history(sessionRef, { limit: 1000 })
    return messages
  }

  return {
    ready: () => typeof sessionRefOf() === 'string' && sessionRefOf() !== '',
    messageIds: async () => new Set((await messagesOf() ?? []).map(message => message.id)),
    findReply: async (ref, before) => {
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
      const chatId = room()?.chatRoom?.id
      if (typeof chatId !== 'string' || chatId === '') return true
      try {
        const rooms = await engine.rooms()
        const found = rooms.find(item => item.id === chatId)
        return found === undefined || found.working !== true
      } catch {
        return true
      }
    },
  }
}
