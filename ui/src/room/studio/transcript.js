import { createElement as h, useMemo } from 'react'
import { ApprovalCard } from '../../approval-card.js'
import { DeliveryCard } from './delivery-card.js'
import { dedupeChatStreams } from '../timeline-model.js'
import { renderStudioMessage } from './message-view.js'
import { StageChapter } from './stage-chapter.js'
import { StepGroup } from './step-group.js'
import { StudioStep } from './step-line.js'
import {
  buildStageChapters,
  groupSteps,
  orderTranscript,
  showsSeat,
} from './transcript-model.js'

// 工作室时间线按阶段分章：当前阶段展开，已完成阶段收成一行，交付卡在最后。
export function StudioTranscript({
  room,
  seats,
  onAccept,
  onStageAccept,
  onApproval,
  hideKinds = [],
  delivery = null,
}) {
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const messages = useMemo(() => dedupeChatStreams(room.messages), [room.messages])
  const items = useMemo(() => {
    const { timeline, items: ordered } = orderTranscript(messages)
    const hidden = new Set(hideKinds)
    const visible = ordered.filter(message => {
      if (hidden.has(message.kind)) return false
      if (message.kind === 'advisor_advice') return false
      if (message.kind === 'verdict' && message.meta?.human === true) return false
      if (room.state === 'complete' && message.kind === 'system' && /等你签字/.test(String(message.text ?? ''))) return false
      return true
    })
    return { timeline, chapters: buildStageChapters(visible, room) }
  }, [messages, hideKinds, room.state, room.stages, room.leadSeat])

  const renderChapterBody = chapter => {
    const body = groupSteps(chapter.items)
    const liveStage = chapter.state === 'active' && room.state === 'active' && room.busy === true
    return body.map((item, index) => {
      const live = liveStage && index === body.length - 1
      if (item.kind === 'steps') return h(StepGroup, { key: item.key, steps: item.steps, live })
      if (item.kind === 'activity' && item.meta?.ok !== false) {
        return h(StudioStep, { key: item.id, step: item, live })
      }
      const content = renderStudioMessage({
        room,
        byId,
        message: item,
        timeline: items.timeline,
        onAccept,
        onStageAccept,
      })
      if (content === null) return null
      const lead = item.kind === 'chat' && !showsSeat(body, index) ? 'cont' : 'first'
      return h('div', { key: item.id, className: 'studio-seat-block', 'data-lead': lead === 'first' ? 'true' : 'false' }, content)
    }).filter(Boolean)
  }

  const pendingApprovals = (room.approvals ?? []).filter(approval => approval.state === 'pending')

  return h('div', { className: 'studio-timeline' }, ...[
    ...items.chapters.map(chapter => h(StageChapter, { key: chapter.key, chapter }, ...renderChapterBody(chapter))),
    delivery === null || delivery === undefined
      ? null
      : h(DeliveryCard, { key: 'delivery', delivery }),
    ...pendingApprovals
      .slice(0, 1)
      .map(approval => h(ApprovalCard, {
        key: approval.id,
        approval,
        onDecide: decision => onApproval(approval.id, decision),
      })),
    pendingApprovals.length > 1
      ? h('div', { key: 'approval-queue', className: 'crew-system' },
        `还有 ${pendingApprovals.length - 1} 个待批准，处理完当前这个再出现。`)
      : null,
  ].filter(Boolean))
}
