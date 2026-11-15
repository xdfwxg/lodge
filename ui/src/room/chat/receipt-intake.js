import { createElement as h } from 'react'
import { IntakeSection } from '../intake-section.js'

// 聊天室只读这次回执；工作室的阶段、证据与过程没有跟过来。
export function ReceiptIntake({ receipt }) {
  if (receipt === null || receipt === undefined) return null
  return h('details', { className: 'studio-intake' },
    h('summary', null, `来自工作室的回执 · ${receipt.result}`),
    h('div', { className: 'studio-intake-body' },
      receipt.completeness === ''
        ? null
        : h('p', { className: 'crew-field-hint' }, receipt.completeness),
      h(IntakeSection, { label: '检查', items: receipt.checks }),
      h(IntakeSection, { label: '开放问题', items: receipt.openQuestions, warning: true })))
}
