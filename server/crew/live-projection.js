export const seatFor = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const [seat, memberRef] of Object.entries(room?.seatBots ?? {})) {
    if (memberRef === ref) return seat
  }
  return null
}

import { toDisplayMentions } from './seat-labels.js'

export const seatNameOf = (room, seat) => (
  room?.seatNames?.[seat] ?? room?.seatSpecs?.find(item => item.id === seat)?.name ?? seat
)

export const createMessageProjector = ({ store }) => {
  const toStored = (roomId, message) => {
    const room = store.readRoom(roomId)
    if (room?.hiddenBaseMessages?.includes(message.id) === true) return null
    const seat = seatFor(room, message.authorRef)
    const common = { id: message.id, roomId, ts: message.at }
    const text = toDisplayMentions(room, message.text)
    if (message.role === 'user') return { ...common, kind: 'chat', authorId: 'you', text }
    if (message.kind === 'activity') {
      return { ...common, kind: 'activity', authorId: seat ?? 'executor', text, meta: { ok: message.ok } }
    }
    if (message.kind === 'question') return { ...common, kind: 'system', text: `房间在等你处理：${text}` }
    // digest 是基座的上下文摘要，不是席位说的话；notice 等是运行提示，归系统，不伪装成聊天。
    if (message.kind === 'digest') return null
    if (['notice', 'lookup', 'resumed', 'cut', 'stopped', 'done'].includes(message.kind)) {
      return text === '' ? null : { ...common, kind: 'system', text }
    }
    return { ...common, kind: 'chat', authorId: seat ?? 'executor', text }
  }

  return { toStored }
}
