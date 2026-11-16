import { deliverToBase } from '../member-delivery.js'
import { memberOf } from '../room-members.js'

const chatIdOf = room => {
  const id = room?.chatRoom?.id
  return typeof id === 'string' && id !== '' ? id : null
}

// 基座身体：成员线程就是它的收发端；Lodge 只把成员翻译成基座成员引用。
export const createBaseSurface = ({ engine }) => {
  const surface = {
    kind: 'base',

    send: input => deliverToBase(input),

    async cancel({ room, queueId }) {
      const chatId = chatIdOf(room)
      if (chatId === null) throw new Error('这个房间还没有群聊，消息没有送出')
      return engine.cancelRoomQueue(chatId, queueId)
    },

    async hold({ room, memberId, held }) {
      const chatId = chatIdOf(room)
      const memberRef = memberOf(room, memberId)?.body?.ref
      if (chatId === null || typeof memberRef !== 'string' || memberRef === '') {
        throw new Error('这个成员没有基座地址')
      }
      await engine.setRoomHold(chatId, memberRef, held)
      return { ok: true, memberId, held }
    },

    state({ room, memberId }) {
      const member = memberOf(room, memberId)
      return {
        kind: 'base',
        memberId,
        memberRef: member?.body?.ref ?? null,
        sessionRef: member?.body?.sessionRef ?? null,
        roomId: chatIdOf(room),
        held: (room?.heldMembers ?? []).includes(memberId),
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
