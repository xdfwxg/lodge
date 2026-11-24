import { createElement as h, useId } from 'react'
import { IntakeSection } from './intake-section.js'

// 只有一处需要人拍板：分歧看没看过。验收方式由规划师在方案里定。
export const gateCardState = ({ needsReview, reviewed }) => {
  const ready = !needsReview || reviewed
  return {
    ready,
    status: ready ? '可以开工' : '有分歧',
    pendingText: ready ? null : '先确认这些分歧，再开工。',
  }
}

// Gate 的决策卡：先让人做决定，再把完整交接简报收进展开项。
export function HandoffBriefReview({
  handoffBrief,
  reviewed,
  onReviewed,
  sourceName = '',
}) {
  const id = useId()
  const needsReview = handoffBrief.disagreements.length > 0
  const { ready, status } = gateCardState({ needsReview, reviewed })
  const sourceLabel = sourceName === '' ? '来自聊天室的交接简报' : `来自「${sourceName}」的交接简报`
  const detailSummary = `共识 ${handoffBrief.consensus.length} · 约束 ${handoffBrief.constraints.length} · 待办 ${handoffBrief.todos.length}`
  return h('div', { className: 'crew-card crew-handoff-review' },
    h('div', { className: 'crew-card-head' },
      h('span', { className: 'crew-handoff-source', title: sourceLabel }, sourceLabel),
      h('span', {
        className: 'crew-verdict',
        'data-pending': ready ? undefined : true,
        'data-pass': ready ? true : undefined,
      }, status)),
    h('div', { className: 'crew-card-body' },
      h('p', { className: 'crew-handoff-topic' }, handoffBrief.topic),
      needsReview
        ? h('div', { className: 'crew-gate-decision' },
          h(IntakeSection, { label: '待确认的分歧', items: handoffBrief.disagreements, warning: true }),
          h('label', { className: 'crew-check', htmlFor: id },
            h('input', {
              id,
              type: 'checkbox',
              checked: reviewed,
              onChange: event => onReviewed(event.target.checked),
            }),
            '这些分歧我看过了'))
        : null,
      h('div', { className: 'crew-gate-check' },
        h('b', null, '开工后'),
        h('p', { className: 'crew-field-hint' }, '验收方式由规划师在方案里定。')),
      h('details', { className: 'crew-handoff-more' },
        h('summary', null, `完整交接简报 · ${detailSummary}`),
        h('div', { className: 'crew-handoff-more-body' },
          h(IntakeSection, { label: '共识', items: handoffBrief.consensus }),
          h(IntakeSection, { label: '约束', items: handoffBrief.constraints }),
          h(IntakeSection, { label: '待办', items: handoffBrief.todos })))))
}
