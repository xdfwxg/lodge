import { createElement as h } from 'react'
import { IntakeSection } from './intake-section.js'

// 带回聊天室的结果只读回执：不重放工作室过程，只留下结果与待确认。
export function ReceiptReview({ receipt }) {
  if (receipt === null || receipt === undefined) return null
  return h('div', { className: 'crew-card crew-handoff-review' },
    h('div', { className: 'crew-card-head' },
      '从工作室带回的结果',
      h('span', { className: 'crew-verdict', 'data-pass': true }, '已交付')),
    h('div', { className: 'crew-card-body' },
      h('p', { className: 'crew-handoff-topic' }, receipt.result),
      receipt.completeness === ''
        ? null
        : h('p', { className: 'crew-field-hint' }, receipt.completeness),
      h(IntakeSection, { label: '文件', items: receipt.paths ?? [] }),
      h(IntakeSection, { label: '检查', items: receipt.checks }),
      h(IntakeSection, { label: '开放问题', items: receipt.openQuestions, warning: true })))
}
