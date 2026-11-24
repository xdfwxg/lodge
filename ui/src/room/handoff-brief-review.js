import { createElement as h, useId } from 'react'
import { IntakeSection } from './intake-section.js'
import { VerifyChoice } from './verify-choice.js'

export const gateCardState = ({
  needsReview,
  reviewed,
  verify = 'manual',
  acceptance = '',
  plannedAcceptance = false,
}) => {
  const missingCommand = verify === 'test' && acceptance.trim() === '' && plannedAcceptance !== true
  const ready = (!needsReview || reviewed) && !missingCommand
  return {
    ready,
    status: ready ? '可以开工' : needsReview && !reviewed ? '有分歧' : '还差一条检查',
    pendingText: ready
      ? null
      : needsReview && !reviewed ? '先确认这些分歧，再开工。' : '填一条检查后再开工。',
  }
}

// Gate 的决策卡：先让人做决定，再把完整交接简报收进展开项。
export function HandoffBriefReview({
  handoffBrief,
  reviewed,
  onReviewed,
  sourceName = '',
  verify = 'manual',
  acceptance = '',
  plannedAcceptance = false,
  onVerifyMode = null,
  onAcceptanceDraft = null,
}) {
  const id = useId()
  const needsReview = handoffBrief.disagreements.length > 0
  const { ready, status } = gateCardState({ needsReview, reviewed, verify, acceptance, plannedAcceptance })
  const editable = typeof onVerifyMode === 'function'
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
        editable
          ? h(VerifyChoice, {
            verifyMode: verify,
            onVerifyMode,
            acceptanceDraft: acceptance,
            onAcceptanceDraft,
          })
          : verify === 'test'
            ? plannedAcceptance
              ? null
              : h('p', { className: 'crew-field-hint' }, acceptance === '' ? '还没填检查' : `跑一条检查：${acceptance}`)
            : null),
      h('details', { className: 'crew-handoff-more' },
        h('summary', null, `完整交接简报 · ${detailSummary}`),
        h('div', { className: 'crew-handoff-more-body' },
          h(IntakeSection, { label: '共识', items: handoffBrief.consensus }),
          h(IntakeSection, { label: '约束', items: handoffBrief.constraints }),
          h(IntakeSection, { label: '待办', items: handoffBrief.todos })))))
}
