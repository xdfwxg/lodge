import { createElement as h, useId } from 'react'

function Section({ label, items, warning = false }) {
  if (items.length === 0) return null
  return h('div', { className: `crew-handoff-section${warning ? ' is-warning' : ''}` },
    h('b', null, label),
    h('ul', null, items.map((item, index) => h('li', { key: `${label}-${index}` }, item))))
}

// Gate 的人工审阅卡：先看分歧，再决定要不要带进工作室。
export function HandoffReview({ handoff, reviewed, onReviewed }) {
  const id = useId()
  const needsReview = handoff.disagreements.length > 0
  return h('div', { className: 'crew-card crew-handoff-review' },
    h('div', { className: 'crew-card-head' },
      '从聊天室带来的交接',
      h('span', {
        className: 'crew-verdict',
        'data-pending': needsReview ? true : undefined,
        'data-pass': needsReview ? undefined : true,
      }, needsReview ? '有分歧' : '可以开工')),
    h('div', { className: 'crew-card-body' },
      h('p', { className: 'crew-handoff-topic' }, handoff.topic),
      Section({ label: '共识', items: handoff.consensus }),
      Section({ label: '还没解决的分歧', items: handoff.disagreements, warning: true }),
      Section({ label: '约束', items: handoff.constraints }),
      Section({ label: '待办', items: handoff.todos }),
      needsReview
        ? h('label', { className: 'crew-check', htmlFor: id },
          h('input', {
            id,
            type: 'checkbox',
            checked: reviewed,
            onChange: event => onReviewed(event.target.checked),
          }),
          '我看过这些分歧，决定继续')
        : null))
}
