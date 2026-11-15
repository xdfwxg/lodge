import { Fragment, createElement as h, useMemo } from 'react'
import { ApprovalCard } from '../../approval-card.js'
import { DeliveryCard } from './delivery-card.js'
import { GateLine } from './gate-line.js'
import { dedupeChatStreams } from '../timeline-model.js'
import { renderStudioMessage } from './message-view.js'
import { StageChapter } from './stage-chapter.js'
import { StepGroup } from './step-group.js'
import { StudioStep } from './step-line.js'
import {
  buildStageChapters,
  displayableStep,
  groupSteps,
  isStandbyChat,
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
  onContinue = null,
  hideKinds = [],
  delivery = null,
}) {
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const messages = useMemo(() => dedupeChatStreams(room.messages), [room.messages])
  const items = useMemo(() => {
    const { timeline, items: ordered } = orderTranscript(messages)
    const hidden = new Set(hideKinds)
    // 一张检查结果已经带上被检查的证据；不再单独铺一张证据卡或阶段结论行。
    const consumedEvidence = new Set(messages
      .filter(message => message.kind === 'verdict' && typeof message.meta?.evidenceId === 'string')
      .map(message => message.meta.evidenceId))
    const visible = ordered.filter(message => {
      if (hidden.has(message.kind)) return false
      if (message.kind === 'advisor_advice') return false
      if (message.kind === 'stage_conclusion' || message.kind === 'conclusion') return false
      if (message.kind === 'evidence' && consumedEvidence.has(message.id)) return false
      if (message.kind === 'verdict' && message.meta?.human === true) return false
      if (isStandbyChat(message, room)) return false
      if (room.state === 'complete' && message.kind === 'system' && /等你签字|可以签字/.test(String(message.text ?? ''))) return false
      return true
    })
    return { timeline, chapters: buildStageChapters(visible, room) }
  }, [messages, hideKinds, room.state, room.stages, room.leadSeat])

  const renderChapterBody = chapter => {
    const body = groupSteps(chapter.items)
    const liveStage = chapter.state === 'active' && room.state === 'active' && room.busy === true
    const activeIndex = room.stages.findIndex(stage => stage.state === 'active')
    const decisionStage = room.needsYou?.kind === 'decision' && chapter.index === activeIndex
    return body.map((item, index) => {
      const live = liveStage && index === body.length - 1
      // 等用户拍板时，工具调用不是主角；决策卡先说话。
      if (item.kind === 'steps' && decisionStage) return null
      if (item.kind === 'steps') return h(StepGroup, { key: item.key, steps: item.steps, live })
      if (item.kind === 'activity') {
        return displayableStep(item) ? h(StudioStep, { key: item.id, step: item, live }) : null
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

  const timeline = h('div', { className: 'studio-timeline' }, ...[
    h(GateLine, { key: 'gate', gate: room.gate }),
    ...items.chapters.map(chapter => h(StageChapter, { key: chapter.key, chapter }, ...renderChapterBody(chapter))),
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

  const result = delivery === null || delivery === undefined
    ? null
    : h(DeliveryCard, { key: 'delivery', delivery, onContinue })

  // A finished room leads with what was delivered. The stage-by-stage record
  // stays available, but folded, so the first screen is the outcome.
  if (room.state === 'complete' && result !== null) {
    return h(Fragment, null,
      h('div', { className: 'studio-result-first' }, result),
      h('details', { className: 'studio-worklog' },
        h('summary', null, '工作记录'),
        h('div', { className: 'studio-worklog-body' }, timeline)))
  }

  return h(Fragment, null, timeline, result)
}
