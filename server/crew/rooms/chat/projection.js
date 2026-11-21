// 聊天室的消息投影规则：只看聊天内容，同一条发言只保留最终版本。
export const dropStaleStreams = messages => {
  const finals = new Set(messages
    .filter(message => message.kind === 'chat' && !String(message.id).startsWith('stream:'))
    .map(message => `${message.authorId}|${message.ts}|${String(message.text ?? '').trim()}`))
  return messages.filter(message => (
    !(message.kind === 'chat' &&
      String(message.id).startsWith('stream:') &&
      finals.has(`${message.authorId}|${message.ts}|${String(message.text ?? '').trim()}`))
  ))
}

export const chatProjection = {
  hideActivity: true,
  acceptsDelta: true,
  filterMessages: (messages, noise) => dropStaleStreams(messages
    .filter(message => !noise(message))),
}
