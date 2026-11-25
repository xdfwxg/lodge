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

// 基座会把一次回答拆成几条 text：先一句过场（“我先看下…”），再给正文。
// 房间里一次回答只留最后一条，否则同一个人连说两句，还会把“上一位”挤到看不见的地方。
export const dropTurnPreambles = messages => {
  const endings = new Map()
  const laterThan = (message, index, prior) => {
    const finalA = message.meta?.turnFinal === true || message.meta?.final === true
    const finalB = prior.message.meta?.turnFinal === true || prior.message.meta?.final === true
    if (finalA !== finalB) return finalA
    const a = message.ts ?? 0
    const b = prior.message.ts ?? 0
    return a > b || (a === b && index > prior.index)
  }
  const turnOf = message => (
    message.kind === 'chat' && typeof message.meta?.turnId === 'string' && message.meta.turnId !== ''
      ? message.meta.turnId
      : null
  )
  messages.forEach((message, index) => {
    const turnId = turnOf(message)
    if (turnId === null) return
    const key = `${message.authorId}|${turnId}`
    const prior = endings.get(key)
    if (prior === undefined || laterThan(message, index, prior)) endings.set(key, { message, index })
  })
  return messages.filter(message => {
    const turnId = turnOf(message)
    if (turnId === null) return true
    return endings.get(`${message.authorId}|${turnId}`)?.message.id === message.id
  })
}

// 结论复核是内部检查，不是发言：复核窗口内该成员的回答、以及已经复核过的回合，
// 都不进时间线。窗口和回合 id 由调度器写在 chat 状态上。
const memberIdOfRef = (room, ref) => (
  (room?.members ?? []).find(member => member?.body?.ref === ref)?.id ?? null
)

export const hiddenByReview = (room, message) => {
  const turnId = typeof message?.turnId === 'string' ? message.turnId : message?.turn?.turnId
  if (typeof turnId === 'string' && (room?.chat?.hiddenTurns ?? []).includes(turnId)) return true
  const reviewing = room?.chat?.reviewing
  const memberId = typeof message?.memberId === 'string' ? message.memberId : memberIdOfRef(room, message?.authorRef)
  return typeof reviewing === 'string' && reviewing !== '' && memberId === reviewing
}

export const chatProjection = {
  hideActivity: true,
  acceptsDelta: true,
  hiddenMessageOf: hiddenByReview,
  filterMessages: (messages, noise) => dropTurnPreambles(dropStaleStreams(messages
    .filter(message => !noise(message)))),
}
