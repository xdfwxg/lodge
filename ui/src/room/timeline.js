import { createElement as h, useMemo, useState } from 'react'
import { ApprovalCard } from '../approval-card.js'
import { Markdown, ActivityLine, ChatLine, EvidenceCard, VerdictCard, DispatchCard, StageConclusionCard, ConclusionCard } from '../message-cards.js'
import { ConfirmationPoints, confirmationItems } from './opening-points.js'

function ConfirmedOpening({ room, stage, index }) {
  const [open, setOpen] = useState(false)
  const next = room.stages[index + 1]
  if (confirmationItems(room).length === 0) return null
  return h('div', { className: 'crew-opening' },
    h('button', {
      type: 'button',
      className: 'crew-opening-row',
      'aria-expanded': open,
      onClick: () => setOpen(value => !value),
    },
    h('span', { className: 'crew-opening-check' }, '✓'),
    h('span', { className: 'crew-opening-title' }, `开工卡已确认 · ${stage.title}`),
    h('span', { className: 'crew-opening-meta' }, `阶段 ${index + 1}/${room.stages.length}`),
    h('span', { className: 'crew-opening-toggle' }, open ? '收起' : '详情')),
    open
      ? h('div', { className: 'crew-opening-body' },
        h(ConfirmationPoints, { room }),
        h('p', { className: 'crew-gate-next' },
          next === undefined
            ? '已确认，等待交付。'
            : `已进入阶段 ${index + 2}「${next.title}」。`))
      : null)
}

const TIME_GAP = 5 * 60 * 1000
const timeLabel = ts => {
  const date = new Date(ts)
  const now = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === now.toDateString()) return time
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function Timeline({ room, seats, onAccept, onApproval }) {
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const firstDeliverable = room.stages.findIndex(stage => stage.kind === 'deliverable')
  const opening = room.stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage, index }) => (
      stage.state === 'passed' &&
      stage.kind === 'decision' &&
      /确认|对齐/.test(stage.title ?? '') &&
      (firstDeliverable < 0 || index < firstDeliverable)
    ))
    .at(-1)

  const timeMarks = new Map()
  let previousTs = null
  for (const message of room.messages) {
    if (typeof message.ts !== 'number') continue
    if (previousTs !== null && message.ts - previousTs >= TIME_GAP) timeMarks.set(message.id, message.ts)
    previousTs = message.ts
  }

  const renderMessage = message => {
    const seat = byId[message.authorId] ?? (message.authorId === 'system' ? { name: '运行时', title: '验收员' } : undefined)
    const content = (() => {
      if (message.kind === 'system') return h('div', { key: message.id, className: 'crew-system' }, message.text)
      if (message.kind === 'dispatch') return h(DispatchCard, { key: message.id, message, seat })
      if (message.kind === 'stage_conclusion') return h(StageConclusionCard, { key: message.id, message })
      if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
      if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
      if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
      if (message.kind === 'verdict') {
        return h(VerdictCard, {
          key: message.id,
          message,
          seat,
          room,
          stage: room.stages[message.meta?.stage ?? 0],
          onAccept,
        })
      }
      if (message.authorId === 'you') {
        return h('div', { key: message.id, className: 'crew-human' },
          h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })),
          h('span', { className: 'crew-human-avatar' }, '你'))
      }
      return h(ChatLine, { key: message.id, message, seat })
    })()
    const mark = timeMarks.get(message.id)
    return mark === undefined
      ? content
      : [h('div', { key: `time-${message.id}`, className: 'crew-time' }, timeLabel(mark)), content]
  }

  // 人刚说的话应该出现在记录末尾，而不是被行动卡挤到对话中间。
  let trailingStart = room.messages.length
  while (trailingStart > 0) {
    const message = room.messages[trailingStart - 1]
    if (message.kind !== 'chat' || message.authorId !== 'you') break
    trailingStart -= 1
  }

  return [
    ...room.messages.slice(0, trailingStart).map(renderMessage),
    ...(room.approvals ?? [])
      .filter(approval => approval.state === 'pending')
      .map(approval => h(ApprovalCard, {
        key: approval.id,
        approval,
        onDecide: decision => onApproval(approval.id, decision),
      })),
    opening === undefined ? null : h(ConfirmedOpening, {
      key: 'opening-confirmed',
      room,
      stage: opening.stage,
      index: opening.index,
    }),
    ...room.messages.slice(trailingStart).map(renderMessage),
  ].filter(Boolean)
}

export { Timeline }
