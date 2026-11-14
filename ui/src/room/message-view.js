import { createElement as h } from 'react'
import {
  Markdown,
  ActivityLine,
  ChatLine,
  EvidenceCard,
  VerdictCard,
  DispatchCard,
  DispatchSummaryCard,
  MilestoneLine,
  ConclusionCard,
  ChatConclusionCard,
} from '../message-cards.js'
import { isDispatchHandoff } from './handoff.js'
import { hostLabelOf } from './host.js'

// 消息类型分发两种房型共用；调用方决定时间标记、分组和占位。
export const resolveSeat = (room, byId, message) => (
  byId[message.authorId]
  ?? (message.authorId === 'lodge' ? { id: 'lodge', name: hostLabelOf(room), title: '' } : undefined)
  ?? (message.authorId === 'system' ? { name: '运行时', title: '验收员' } : undefined)
)

export const renderMessageBody = ({
  room,
  byId,
  message,
  timeline,
  onAccept,
  onStageAccept,
  onContinueChat,
  onStartStudio,
}) => {
  // 人工签字已有“阶段 N 已按证据验收”的系统行；不再复制一张验收员样式的卡。
  if (message.kind === 'verdict' && message.meta?.human === true) return null
  if (isDispatchHandoff(room, message)) return h(DispatchSummaryCard, { key: message.id, message })
  const seat = resolveSeat(room, byId, message)
  if (message.kind === 'system' || message.kind === 'advisor_advice' || message.kind === 'child_result') {
    return h('div', { key: message.id, className: 'crew-system' }, message.text)
  }
  if (message.kind === 'dispatch') return h(DispatchCard, { key: message.id, message, seat })
  if (message.kind === 'stage_conclusion') return h(MilestoneLine, { key: message.id, message })
  if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
  if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
  if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
  if (message.kind === 'chat_conclusion') {
    return h(ChatConclusionCard, {
      key: message.id,
      message,
      seat: byId[message.authorId] ?? { id: 'lodge', name: hostLabelOf(room), title: '' },
      room,
      onAccept,
      onContinueChat,
      onStartStudio,
    })
  }
  if (message.kind === 'verdict') {
    return h(VerdictCard, {
      key: message.id,
      message,
      seat,
      room,
      stage: room.stages[message.meta?.stage ?? 0],
      onAccept: onStageAccept === null ? undefined : onStageAccept ?? onAccept,
      evidence: timeline.evidenceFor.get(message.id),
    })
  }
  if (message.authorId === 'you') {
    return h('div', { key: message.id, className: 'crew-human' },
      h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })),
      h('span', { className: 'crew-human-avatar' }, '你'))
  }
  return h(ChatLine, { key: message.id, message, seat })
}
