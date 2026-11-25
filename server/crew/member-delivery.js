import { randomUUID } from 'node:crypto'
import { hostAddress, memberAddress, memberDisplayName, toBaseMentions } from './member-labels.js'
import { memberOf } from './room-members.js'
import { humanNameOf } from './human-name.js'

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
  // 人内部叫 you；给成员看的信封要用人的名字，成员才不会把 you 当成可点名的人。
  if (from === 'you') return humanNameOf() || '用户'
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
  privateRoom = false,
}) => {
  const current = store.readRoom(roomId) ?? room
  const address = memberId === 'host'
    ? hostAddress(current)
    : memberAddress(current, memberId)
  if (address === null) {
    const name = memberId === 'host'
      ? '主持人'
      : memberDisplayName(current, memberId)
    return Promise.reject(new Error(`${name} 还没有连上 Lodge 服务，消息没有送出`))
  }
  // 叫停是人的决定：系统的自动派发不能靠一次 @ 把成员重新叫起来。
  if (Array.isArray(current.heldMembers) && current.heldMembers.includes(memberId)) {
    return Promise.reject(new Error(`${memberDisplayName(current, memberId)} 已叫停；先继续，再派任务`))
  }
  const addressed = toBaseMentions(current, String(text))
  const trimmed = addressed.trimStart()
  const withoutMention = trimmed.startsWith(address.mention)
    ? trimmed.slice(address.mention.length).trimStart()
    : trimmed
  // 成员的私有房间就是它自己的工作副本：并行派发送到这里，成员才会在自己的目录里干活。
  const privateId = privateRoom === true ? memberOf(current, memberId)?.body?.roomRef : null
  if (privateRoom === true) {
    if (typeof privateId !== 'string' || privateId === '') {
      return Promise.reject(new Error(`${memberDisplayName(current, memberId)} 没有私有工作区，消息没有送出`))
    }
    const body = [
      envelope ?? envelopeFor(current, from, intent),
      withoutMention,
    ].filter(line => line !== '').join('\n')
    return engine.sendTurn({ roomId: privateId, text: body, sendId })
      .then(sent => ({ ...sent, sendId }))
  }
  const chatId = current?.chatRoom?.id ?? room?.chatRoom?.id
  if (typeof chatId !== 'string' || chatId === '') {
    return Promise.reject(new Error('这个房间还没有群聊，消息没有送出'))
  }
  const body = [
    address.mention,
    envelope ?? envelopeFor(current, from, intent),
    withoutMention,
  ].filter(line => line !== '').join('\n')
  return engine.sendTurn({ roomId: chatId, text: body, sendId, mentions: [address.memberRef] })
    .then(sent => ({ ...sent, sendId }))
}
