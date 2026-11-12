export const seatFor = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const [seat, memberRef] of Object.entries(room?.seatBots ?? {})) {
    if (memberRef === ref) return seat
  }
  return null
}

export const seatNameOf = (room, seat) => (
  room?.seatNames?.[seat] ?? room?.seatSpecs?.find(item => item.id === seat)?.name ?? seat
)

export const createMessageProjector = ({ store }) => {
  const toStored = (roomId, message) => {
    const room = store.readRoom(roomId)
    if (room?.hiddenBaseMessages?.includes(message.id) === true) return null
    const seat = seatFor(room, message.authorRef)
    const common = { id: message.id, roomId, ts: message.at }
    if (message.role === 'user') return { ...common, kind: 'chat', authorId: 'you', text: message.text }
    if (message.kind === 'activity') {
      return { ...common, kind: 'activity', authorId: seat ?? 'executor', text: message.text, meta: { ok: message.ok } }
    }
    if (message.kind === 'question') return { ...common, kind: 'system', text: `房间在等你处理：${message.text}` }
    return { ...common, kind: 'chat', authorId: seat ?? 'executor', text: message.text }
  }

  return { toStored }
}
