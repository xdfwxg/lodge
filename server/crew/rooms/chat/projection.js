// 聊天室的消息投影规则：只看聊天内容，同一条发言只保留最终版本。
const DUPLICATE_WINDOW_MS = 5_000

export const dropStaleStreams = messages => {
  const finals = new Set(messages
    .filter(message => message.kind === 'chat' && !String(message.id).startsWith('stream:'))
    .map(message => `${message.authorId}|${message.ts}|${String(message.text ?? '').trim()}`))
  // 同一个成员在几秒内落了两条同源最终流式消息，只保留更完整的那条。
  const streamFinals = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => (
      message.kind === 'chat' &&
      String(message.id).startsWith('stream:') &&
      message.meta?.final === true
    ))
  const plain = text => String(text ?? '').replace(/\s+/g, ' ').trim()
  const duplicates = new Set()
  for (const { message, index } of streamFinals) {
    const text = plain(message.text)
    const winner = streamFinals.find(({ message: candidate, index: candidateIndex }) => {
      if (candidate.id === message.id || candidate.authorId !== message.authorId) return false
      if (!Number.isFinite(message.ts) || !Number.isFinite(candidate.ts)) return false
      if (Math.abs(message.ts - candidate.ts) > DUPLICATE_WINDOW_MS) return false
      const other = plain(candidate.text)
      if (!other.startsWith(text) && !text.startsWith(other)) return false
      if (other.length !== text.length) return other.length > text.length
      return candidate.ts < message.ts || (candidate.ts === message.ts && candidateIndex < index)
    })
    if (winner !== undefined) duplicates.add(message.id)
  }
  return messages.filter(message => {
    if (message.meta?.stale === true || duplicates.has(message.id)) return false
    if (message.kind !== 'chat' || !String(message.id).startsWith('stream:')) return true
    return !finals.has(`${message.authorId}|${message.ts}|${String(message.text ?? '').trim()}`)
  })
}

export const chatProjection = {
  hideActivity: true,
  acceptsDelta: true,
  filterMessages: (messages, noise) => dropStaleStreams(messages
    .filter(message => !noise(message))),
}
