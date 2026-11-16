import { createElement as h } from 'react'
import { ActivityLine, ChatLine, Markdown } from '../message-cards.js'
import { QuestionCard } from './question-card.js'
import { hostLabelOf } from './host.js'

// 共享层只处理两种房型都存在的消息；专属类型由各自的渲染器先接管。

export const resolveSeat = (room, byId, message) => (
  byId[message.authorId]
  ?? (message.authorId === 'lodge' ? { id: 'lodge', name: hostLabelOf(room), title: '' } : undefined)
  ?? (message.authorId === 'system' ? { name: '系统', title: '' } : undefined)
)

export const renderSharedMessage = ({
  room,
  byId,
  message,
  onAnswerCard = null,
  onCancelQueue = null,
  onSteerQueue = null,
}) => {
  const seat = resolveSeat(room, byId, message)
  if (message.kind === 'question') {
    return h(QuestionCard, { key: message.id, message, seat, onAnswer: onAnswerCard })
  }
  if (message.kind === 'system' || message.kind === 'advisor_advice' || message.kind === 'child_result') {
    return h('div', { key: message.id, className: 'crew-system' }, message.text)
  }
  if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
  if (message.authorId === 'you') {
    if (message.meta?.cancelled === true) {
      return h('div', { key: message.id, className: 'crew-system' }, '已撤回一条排队消息。')
    }
    return h('div', { key: message.id, className: 'crew-human' },
      h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })),
      message.meta?.queueId === undefined
        ? null
        : h('div', { className: 'crew-queue-actions' },
          h('span', null, '排队中'),
          onCancelQueue === null
            ? null
            : h('button', { type: 'button', className: 'studio-presence-action', onClick: () => onCancelQueue(message.meta.queueId) }, '撤回'),
          onSteerQueue === null
            ? null
            : h('button', { type: 'button', className: 'studio-presence-action', onClick: () => onSteerQueue(message.meta.queueId) }, '插话')),
      h('span', { className: 'crew-human-avatar' }, '你'))
  }
  return h(ChatLine, { key: message.id, message, seat })
}
