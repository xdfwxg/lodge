import { createElement as h, useMemo, useState } from 'react'
import { ApprovalCard } from '../approval-card.js'
import { Markdown, ActivityLine, ChatLine, EvidenceCard, VerdictCard, DispatchCard, DispatchSummaryCard, MilestoneLine, ConclusionCard, ChatConclusionCard } from '../message-cards.js'
import { isDispatchHandoff } from './handoff.js'
import { buildTimeline } from './timeline-model.js'

const TIME_GAP = 5 * 60 * 1000
const timeLabel = ts => {
  const date = new Date(ts)
  const now = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === now.toDateString()) return time
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function Timeline({ room, seats, onAccept, onApproval, onContinueChat, onStartStudio, compact = false, hideKinds = [] }) {
  const [expanded, setExpanded] = useState(false)
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const timeline = useMemo(() => buildTimeline(room.messages), [room.messages])

  const timeMarks = new Map()
  let previousTs = null
  for (const message of room.messages) {
    if (typeof message.ts !== 'number') continue
    if (previousTs !== null && message.ts - previousTs >= TIME_GAP) timeMarks.set(message.id, message.ts)
    previousTs = message.ts
  }

  const renderMessage = message => {
    if (isDispatchHandoff(room, message)) return h(DispatchSummaryCard, { key: message.id, message })
    const seat = byId[message.authorId] ?? (message.authorId === 'system' ? { name: '运行时', title: '验收员' } : undefined)
    const content = (() => {
      if (message.kind === 'system') return h('div', { key: message.id, className: 'crew-system' }, message.text)
      if (message.kind === 'advisor_advice') {
        return h('div', { key: message.id, className: 'crew-system' }, message.text)
      }
      if (message.kind === 'child_result') return h('div', { key: message.id, className: 'crew-system' }, message.text)
      if (message.kind === 'dispatch') return h(DispatchCard, { key: message.id, message, seat })
      if (message.kind === 'stage_conclusion') return h(MilestoneLine, { key: message.id, message })
      if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
      if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
      if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
      if (message.kind === 'chat_conclusion') {
        return h(ChatConclusionCard, {
          key: message.id,
          message,
          seat: byId[message.authorId] ?? { name: '主持人', title: '' },
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
          onAccept,
          evidence: timeline.evidenceFor.get(message.id),
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

  // 派活、心跳、整房结论与原始回合收进一条可展开的记录。
  const processFold = timeline.process.length === 0
    ? null
    : h('details', { key: 'process-log', className: 'crew-process' },
      h('summary', null, `过程记录 · ${timeline.process.length} 条`),
      h('div', { className: 'crew-process-body' }, timeline.process.map(renderMessage)))

  const hidden = new Set(['activity', 'dispatch', 'advisor_advice', ...hideKinds])
  const meaningful = timeline.visible.filter(message => !hidden.has(message.kind))
  const shown = compact && !expanded ? meaningful.slice(-3) : meaningful
  const showProcess = !compact || expanded
  const canExpand = compact && (meaningful.length > 3 || timeline.process.length > 0)
  return [
    ...shown.map(renderMessage).flat().filter(Boolean),
    ...(room.approvals ?? [])
      .filter(approval => approval.state === 'pending')
      .map(approval => h(ApprovalCard, {
        key: approval.id,
        approval,
        onDecide: decision => onApproval(approval.id, decision),
      })),
    showProcess ? processFold : null,
    canExpand
      ? h('button', {
        key: 'timeline-more',
        type: 'button',
        className: 'crew-timeline-more',
        onClick: () => setExpanded(value => !value),
      }, expanded ? '收起时间线' : `展开全部（${meaningful.length} 条）`)
      : null,
  ].filter(Boolean)
}

export { Timeline }
