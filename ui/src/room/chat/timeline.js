import { createElement as h, useMemo } from 'react'
import { ApprovalCard } from '../../approval-card.js'
import { ChatLine } from '../../message-cards.js'
import { CopyButton, IconAction } from '../../primitives.js'
import { CopyIcon } from '../../icons.js'
import { StudioIcon } from '../type-icons.js'
import { isChainMessage, renderSharedMessage } from '../message-view.js'
import { buildTimeline, dedupeChatStreams } from '../timeline-model.js'
import { hostLabelOf } from '../host.js'
import { chatStudioSeed } from '../../../../shared/room-seeds.js'
import { ChatOpeningCard } from './opening-card.js'
import { scopeIsValid } from '../../../../shared/attempt.js'

const TIME_GAP = 5 * 60 * 1000
const timeLabel = ts => {
  const date = new Date(ts)
  const now = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === now.toDateString()) return time
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function Timeline({
  room,
  members,
  onApproval,
  onAnswerCard = null,
  onCancelQueue = null,
  onSteerQueue = null,
  onStartStudio = null,
  onOpenRoom = null,
  hideKinds = [],
}) {
  const byId = useMemo(() => Object.fromEntries(members.map(member => [member.id, member])), [members])
  const messages = useMemo(() => dedupeChatStreams(room.messages), [room.messages])
  const timeline = useMemo(() => buildTimeline(messages), [messages])

  const timeMarks = new Map()
  let previousTs = null
  for (const message of messages) {
    if (typeof message.ts !== 'number') continue
    if (previousTs !== null && message.ts - previousTs >= TIME_GAP) timeMarks.set(message.id, message.ts)
    previousTs = message.ts
  }

  const renderMessage = message => {
    const content = message.kind === 'chat_conclusion'
      ? h('div', { key: message.id, className: 'crew-msg-wrap crew-conclusion-wrap' },
        h(ChatLine, {
          message,
          member: byId[message.authorId] ?? { id: 'lodge', name: hostLabelOf(room), title: '' },
        }),
        h('div', { className: 'crew-hover-actions crew-conclusion-actions' },
          h(CopyButton, {
            text: message.text,
            label: '复制结论',
            copiedLabel: '已复制',
            className: 'crew-icon-action',
            icon: CopyIcon,
          }),
          typeof onStartStudio === 'function'
            ? h(IconAction, {
              icon: StudioIcon,
              label: '转成工作室',
              onClick: () => onStartStudio(chatStudioSeed({
                room,
                conclusion: message.text,
                handoff: message.meta?.handoff,
              })),
            })
            : null))
      : message.kind === 'chat' && message.meta?.opening === true
        ? h(ChatOpeningCard, {
          key: message.id,
          message,
          member: byId[message.authorId] ?? { id: 'lodge', name: hostLabelOf(room), title: '' },
          room,
        })
        : message.kind === 'chat' && typeof message.meta?.openRoomId === 'string'
          ? h('div', { key: message.id, className: 'crew-msg-wrap' },
            h(ChatLine, {
              message,
              member: byId[message.authorId] ?? { id: 'lodge', name: hostLabelOf(room), title: '' },
            }),
            typeof onOpenRoom === 'function'
              ? h('button', {
                type: 'button',
                className: 'crew-link crew-conclusion-convert',
                onClick: () => onOpenRoom(message.meta.openRoomId),
              }, message.meta.openRoomName === undefined ? '打开这间房' : `打开：${message.meta.openRoomName}`)
              : null)
          : renderSharedMessage({ room, byId, message, onAnswerCard, onCancelQueue, onSteerQueue })
    if (content === null) return null
    const mark = timeMarks.get(message.id)
    return mark === undefined
      ? content
      : [h('div', { key: `time-${message.id}`, className: 'crew-time' }, timeLabel(mark)), content]
  }

  const roomMessages = Array.isArray(room.messages) ? room.messages : []
  const pendingApprovals = (room.approvals ?? []).filter(approval => (
    approval.state === 'pending' && scopeIsValid(approval.scope, { room, messages: roomMessages })
  ))
  const hidden = new Set(['activity', ...hideKinds])
  const meaningful = timeline.visible.filter(message => {
    if (hidden.has(message.kind)) return false
    if (message.kind === 'system' || message.meta?.authorKind === 'system') return isChainMessage(message)
    return true
  })
  return [
    ...meaningful.map(renderMessage).flat().filter(Boolean),
    ...pendingApprovals
      .slice(0, 1)
      .map(approval => h(ApprovalCard, {
        key: approval.id,
        approval,
        onDecide: decision => onApproval(approval.id, decision),
      })),
    pendingApprovals.length > 1
      ? h('div', { key: 'approval-queue', className: 'crew-system' },
        `还有 ${pendingApprovals.length - 1} 个操作待确认，先处理眼前这个。`)
      : null,
  ].filter(Boolean)
}

export { Timeline }
