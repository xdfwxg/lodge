// 人的重做标记和 human-context 是同一条输入的两种记录；主时间线只留后者。
export const humanNoteKey = message => (
  `${message?.meta?.stage ?? ''}|${String(message?.text ?? '').trim()}`
)

export const humanNoteKeys = messages => new Set(
  (Array.isArray(messages) ? messages : [])
    .filter(message => message.kind === 'human-context')
    .map(humanNoteKey),
)

export const isDuplicateHumanRework = (message, keys) => (
  message?.kind === 'rework' &&
  message?.authorId === 'you' &&
  keys instanceof Set &&
  keys.has(humanNoteKey(message))
)
