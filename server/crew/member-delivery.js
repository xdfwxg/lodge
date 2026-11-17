import { randomUUID } from 'node:crypto'
import { hostAddress, memberAddress, memberDisplayName, shadowAddress, toBaseMentions } from './member-labels.js'
import { memberOf } from './room-members.js'

const INTENTS = Object.freeze({
  handoff: { label: '阶段交接', authority: '按你的角色执行' },
  align: { label: '目标对齐', authority: '只写对齐判断和待确认项' },
  review: { label: '复核', authority: '只读 · 只写结论' },
  decision: { label: '退回决定', authority: '只写你的决定和理由' },
  chat: { label: '聊天发言', authority: '信息' },
  notice: { label: '通知', authority: '信息' },
})

const fromLabel = (room, from) => {
  if (typeof from !== 'string' || from === '') return ''
  return memberOf(room, from) === null ? from : memberDisplayName(room, from)
}

// 信封由 harness 写，不由模型写；下面的正文才是模型内容。
export const envelopeOf = ({ from = '', intent = 'handoff' } = {}) => {
  const entry = INTENTS[intent] ?? INTENTS.handoff
  return `[来自 ${from || 'Lodge'} · ${entry.label} · ${entry.authority}]`
}

export const envelopeFor = (room, from, intent = 'handoff') => envelopeOf({ from: fromLabel(room, from), intent })

// 基座投递原语：负责地址、信封、幂等键与发送，不决定这个成员用哪种身体。
export const deliverToBase = ({
  engine,
  store,
  roomId,
  room = null,
  memberId,
  text,
  sendId = randomUUID(),
  intent = 'handoff',
  from = '',
  envelope = null,
}) => {
  const current = store.readRoom(roomId) ?? room
  const address = memberId === 'host'
    ? hostAddress(current)
    : memberId === 'shadow' ? shadowAddress(current) : memberAddress(current, memberId)
  if (address === null) {
    const name = memberId === 'host'
      ? '主持人'
      : memberId === 'shadow' ? '影子评审' : memberDisplayName(current, memberId)
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
    envelope ?? envelopeFor(current, from, intent),
    withoutMention,
  ].filter(line => line !== '').join('\n')
  return engine.sendTurn({ roomId: chatId, text: body, sendId, mentions: [address.memberRef] })
    .then(sent => ({ ...sent, sendId }))
}
