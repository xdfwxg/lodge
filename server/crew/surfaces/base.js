import { deliverToBase } from '../seat-delivery.js'

const chatIdOf = room => {
  const id = room?.chatRoom?.id
  return typeof id === 'string' && id !== '' ? id : null
}

// 基座身体：成员线程就是它的收发端；Lodge 只把席位翻译成基座成员引用。
export const createBaseSurface = ({ engine }) => {
  const surface = {
    kind: 'base',

    send: input => deliverToBase(input),

    async cancel({ room, queueId }) {
      const chatId = chatIdOf(room)
      if (chatId === null) throw new Error('这个房间还没有群聊，消息没有送出')
      return engine.cancelRoomQueue(chatId, queueId)
    },

    async hold({ room, seat, held }) {
      const chatId = chatIdOf(room)
      const memberRef = room?.seatBots?.[seat]
      if (chatId === null || typeof memberRef !== 'string' || memberRef === '') {
        throw new Error('这个成员没有基座地址')
      }
      await engine.setRoomHold(chatId, memberRef, held)
      return { ok: true, seat, held }
    },

    state({ room, seat }) {
      return {
        kind: 'base',
        seat,
        memberRef: room?.seatBots?.[seat] ?? null,
        sessionRef: room?.seatRooms?.[seat]?.sessionRef ?? null,
        roomId: chatIdOf(room),
        held: (room?.heldSeats ?? []).includes(seat),
      }
    },

    capabilities: () => ({
      kind: 'base',
      send: true,
      cancel: true,
      hold: true,
      stream: true,
    }),
  }
  return surface
}
