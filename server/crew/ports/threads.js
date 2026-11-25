// 群聊线程端口：谁说了什么、房间有没有在忙。
// 房型只依赖这个窄接口，不关心下面接的是哪个基座。
export const createThreadPort = ({ engine, store, roomId }) => {
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
    // 读不到回复是系统错误，不是“这位没说话”；向上抛，房间会停下并保留可继续的状态。
    findReply: async (ref, before) => {
      if (typeof ref !== 'string' || ref === '') return null
      const messages = await messagesOf()
      if (messages === null) return null
      const fresh = messages.filter(message => !before.has(message.id) && message.authorRef === ref)
      // 基座会把一次回答拆成过场和正文；回执只认这一次回答的最后一条，不把过场当成他的观点。
      const turn = fresh.findLast?.(message => message.kind === 'turn' && message.turn?.reply)
      if (turn !== undefined) return { text: turn.turn.reply, turnId: turn.turn?.turnId ?? '' }
      const texts = fresh.filter(message => message.kind === 'text')
      const marked = texts.filter(message => typeof message.turnFinal === 'boolean')
      if (marked.length > 0) {
        const done = marked.filter(message => message.turnFinal === true)
        if (done.length === 0) return null
        const last = done[done.length - 1]
        return { text: last.text ?? '', turnId: last.turnId ?? '' }
      }
      // 基座不标回合时只能按到达顺序取最后一条。
      const last = texts[texts.length - 1]
      return last === undefined ? null : { text: last.text ?? '', turnId: last.turnId ?? '' }
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
