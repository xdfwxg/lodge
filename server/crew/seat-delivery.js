import { hostAddress, seatAddress, seatDisplayName, toBaseMentions } from './seat-labels.js'

// 投递边界：业务说交给哪个席位，这里只负责把席位翻成基座地址并送出。
// 名字是房间里的地址，memberRef 是稳定身份，两者都不回到业务层。
export const deliverToSeat = ({ engine, store, roomId, room = null, seat, text }) => {
  const current = store.readRoom(roomId) ?? room
  const address = seat === 'host' ? hostAddress(current) : seatAddress(current, seat)
  if (address === null) {
    const name = seat === 'host' ? '主持人' : seatDisplayName(current, seat)
    return Promise.reject(new Error(`${name} 没有基座地址，消息没有送出`))
  }
  const chatId = current?.chatRoom?.id ?? room?.chatRoom?.id
  if (typeof chatId !== 'string' || chatId === '') {
    return Promise.reject(new Error('这个房间还没有群聊，消息没有送出'))
  }
  const addressed = toBaseMentions(current, String(text))
  const body = addressed.trimStart().startsWith(address.mention)
    ? addressed
    : `${address.mention} ${addressed}`
  return engine.sendTurn({ roomId: chatId, text: body, mentions: [address.memberRef] })
}
