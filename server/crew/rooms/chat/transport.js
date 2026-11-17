import { hostAddress } from '../../member-labels.js'
import { memberOf } from '../../room-members.js'
import { createBaseThread } from '../base/thread.js'

// 聊天调度只认这个端口：历史、回复和空闲判断都留在适配层。
export const createChatTransport = ({ engine, store, roomId }) => {
  const thread = createBaseThread({ engine, store, roomId })
  const refOf = memberId => {
    const room = store.readRoom(roomId)
    return memberId === 'host'
      ? hostAddress(room)?.memberRef
      : memberOf(room, memberId)?.body?.ref
  }

  return {
    ready: thread.ready,
    messageIds: thread.messageIds,
    findReply: (memberId, before) => thread.findReply(refOf(memberId), before),
    isIdle: thread.isIdle,
  }
}
