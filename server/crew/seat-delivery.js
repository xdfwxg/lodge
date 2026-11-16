import { randomUUID } from 'node:crypto'
import { hostAddress, seatAddress, seatDisplayName, toBaseMentions } from './seat-labels.js'

const INTENTS = Object.freeze({
  handoff: { label: '阶段交接', authority: '按你的角色执行' },
  align: { label: '目标对齐', authority: '只写对齐判断和待确认项' },
  review: { label: '独立复核', authority: '只读 · 只写结论' },
  decision: { label: '退回决定', authority: '只写你的决定和理由' },
  chat: { label: '聊天发言', authority: '信息' },
  notice: { label: '通知', authority: '信息' },
})

const fromLabel = (room, from) => {
  if (typeof from !== 'string' || from === '') return ''
  return (room?.seatSpecs ?? []).some(seat => seat.id === from) ? seatDisplayName(room, from) : from
}

// 信封由 harness 写，不由模型写；下面的正文才是模型内容。
export const envelopeOf = ({ from = '', intent = 'handoff' } = {}) => {
  const entry = INTENTS[intent] ?? INTENTS.handoff
  return `[来自 ${from || 'Lodge'} · ${entry.label} · ${entry.authority}]`
}

// 投递边界：业务说交给哪个席位和什么意图，这里负责地址、信封、幂等键与发送。
export const deliverToSeat = ({
  engine,
  store,
  roomId,
  room = null,
  seat,
  text,
  sendId = randomUUID(),
  intent = 'handoff',
  from = '',
}) => {
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
  const trimmed = addressed.trimStart()
  const withoutMention = trimmed.startsWith(address.mention)
    ? trimmed.slice(address.mention.length).trimStart()
    : trimmed
  const body = [
    address.mention,
    envelopeOf({ from: fromLabel(current, from), intent }),
    withoutMention,
  ].filter(line => line !== '').join('\n')
  return engine.sendTurn({ roomId: chatId, text: body, sendId, mentions: [address.memberRef] })
    .then(sent => ({ ...sent, sendId }))
}
