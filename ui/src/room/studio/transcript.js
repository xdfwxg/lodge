import { createElement as h, useMemo } from 'react'
import { ApprovalCard } from '../../approval-card.js'
import { dedupeChatStreams } from '../timeline-model.js'
import { renderMessageBody } from '../message-view.js'
import { StepGroup } from './step-group.js'
import {
  groupSteps,
  insertDayMarkers,
  orderTranscript,
  showsSeat,
} from './transcript-model.js'

// 工作室时间线：按天分隔、同席连续消息合并说话人、连续步骤收成一条。
export function StudioTranscript({
  room,
  seats,
  onAccept,
  onStageAccept,
  onApproval,
  onStartStudio,
  hideKinds = [],
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
    return { timeline, grouped: groupSteps(insertDayMarkers(visible)) }
  }, [messages, hideKinds, room.state])

  const pendingApprovals = (room.approvals ?? []).filter(approval => approval.state === 'pending')

  return h('div', { className: 'studio-timeline' }, ...[
    ...items.grouped.map((item, index) => {
      if (item.kind === 'day') {
        return h('div', { key: item.key, className: 'studio-day' }, item.label)
      }
      if (item.kind === 'steps') {
        return h(StepGroup, { key: item.key, steps: item.steps })
      }
      // 单条成功步骤多是基座的内部提示；成串的步骤才值得占一行，失败步骤保留。
      if (item.kind === 'activity' && item.meta?.ok !== false) return null
      const content = renderMessageBody({
        room,
        byId,
        message: item,
        timeline: items.timeline,
        onAccept,
        onStageAccept,
        onStartStudio,
      })
      if (content === null) return null
      const lead = item.kind === 'chat' && !showsSeat(items.grouped, index) ? 'cont' : 'first'
      return h('div', { key: item.id, className: 'studio-seat-block', 'data-lead': lead === 'first' ? 'true' : 'false' }, content)
    }),
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
