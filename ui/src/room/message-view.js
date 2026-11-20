import { createElement as h } from 'react'
import { ActivityLine, ChatLine, Markdown } from '../message-cards.js'
import { QuestionCard } from './question-card.js'
import { hostLabelOf } from './host.js'
import { cardStateOf } from '../../../shared/attempt.js'
import { formatAttachmentBytes, splitAttachmentTags } from '../../../shared/attachments.js'

// 共享层只处理两种房型都存在的消息；专属类型由各自的渲染器先接管。

export const resolveMember = (room, byId, message) => (
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
  const member = resolveMember(room, byId, message)
  if (message.kind === 'question') {
    const messages = Array.isArray(room?.messages) ? room.messages : []
    return h(QuestionCard, {
      key: message.id,
      message,
      member,
      onAnswer: onAnswerCard,
      state: cardStateOf(room, message, messages),
    })
  }
  if (message.kind === 'system' || message.kind === 'child_result') {
    return h('div', { key: message.id, className: 'crew-system' }, message.text)
  }
  if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
  if (message.kind === 'rework' && message.meta?.auto === true) {
    return h('div', { key: message.id, className: 'crew-system' }, message.text)
  }
  if (message.authorId === 'you') {
    if (message.meta?.cancelled === true) {
      return h('div', { key: message.id, className: 'crew-system' }, '已撤回一条排队消息。')
    }
    const humanName = typeof room?.humanName === 'string' ? room.humanName.trim() : ''
    const parsed = splitAttachmentTags(message.text)
    const listed = Array.isArray(message.meta?.attachments) ? message.meta.attachments : []
    const attachments = listed.length > 0 ? listed : parsed.attachments
    return h('div', { key: message.id, className: 'crew-human' },
      message.kind === 'human-context'
        ? h('span', { className: 'crew-human-label' }, '补充上下文')
        : humanName === '' || humanName === '你'
          ? null
          : h('span', { className: 'crew-human-name' }, humanName),
      h('div', { className: 'bt-ububble' },
        attachments.length === 0
          ? null
          : h('div', { className: 'crew-attachment-list' },
            attachments.map(item => item.kind === 'image'
              ? h('a', {
                key: item.name,
                className: 'crew-attachment-image',
                href: `/api/attachments/${item.name}`,
                target: '_blank',
                rel: 'noreferrer',
              },
              h('img', { src: `/api/attachments/${item.name}`, alt: item.title ?? item.name, loading: 'lazy' }))
              : h('span', { key: item.name, className: 'crew-attachment-file' },
                h('span', { className: 'crew-attachment-dot', 'aria-hidden': 'true' }),
                h('span', { className: 'crew-attachment-name' }, item.title ?? item.name),
                item.bytes === undefined ? null : h('span', { className: 'crew-attachment-size' }, formatAttachmentBytes(item.bytes))))),
        parsed.text === '' ? null : h(Markdown, { text: parsed.text, variant: 'compact' })),
      message.meta?.queueId === undefined
        ? null
        : h('div', { className: 'crew-queue-actions' },
          h('span', null, '排队中'),
          onCancelQueue === null
            ? null
            : h('button', { type: 'button', className: 'studio-presence-action', onClick: () => onCancelQueue(message.meta.queueId) }, '撤回'),
          onSteerQueue === null
            ? null
            : h('button', { type: 'button', className: 'studio-presence-action', onClick: () => onSteerQueue(message.meta.queueId) }, '插话')))
  }
  // 模型有时把用户写成 @you；显示成名字，没起名字时直接去掉这个称呼。
  const shown = /@you\b/i.test(String(message.text ?? ''))
    ? {
      ...message,
      text: String(message.text).replace(/(^|\s)@you\b/gi, (whole, before) => {
        const name = typeof room?.humanName === 'string' ? room.humanName.trim() : ''
        return name === '' ? before : `${before}${name}`
      }).trim(),
    }
    : message
  return h(ChatLine, { key: message.id, message: shown, member })
}
