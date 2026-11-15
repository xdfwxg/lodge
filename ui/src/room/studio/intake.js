import { createElement as h } from 'react'
import { IntakeSection } from '../intake-section.js'

// 工作室接手时只读这份交接单；原始聊天记录没有跟过来。
export function HandoffIntake({ handoff }) {
  if (handoff === null || handoff === undefined) return null
  return h('details', { className: 'studio-intake' },
    h('summary', null, `来自聊天室的交接 · ${handoff.topic}`),
    h('div', { className: 'studio-intake-body' },
      h(IntakeSection, { label: '共识', items: handoff.consensus }),
      h(IntakeSection, { label: '还没解决的分歧', items: handoff.disagreements, warning: true }),
      h(IntakeSection, { label: '约束', items: handoff.constraints }),
      h(IntakeSection, { label: '待办', items: handoff.todos })))
}
