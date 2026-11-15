import { createElement as h } from 'react'

function Section({ label, items, warning = false }) {
  if (items.length === 0) return null
  return h('div', { className: `crew-handoff-section${warning ? ' is-warning' : ''}` },
    h('b', null, label),
    h('ul', null, items.map((item, index) => h('li', { key: `${label}-${index}` }, item))))
}

// 工作室接手时只读这份交接单；原始聊天记录没有跟过来。
export function HandoffIntake({ handoff }) {
  if (handoff === null || handoff === undefined) return null
  return h('details', { className: 'studio-intake' },
    h('summary', null, `来自聊天室的交接 · ${handoff.topic}`),
    h('div', { className: 'studio-intake-body' },
      Section({ label: '共识', items: handoff.consensus }),
      Section({ label: '还没解决的分歧', items: handoff.disagreements, warning: true }),
      Section({ label: '约束', items: handoff.constraints }),
      Section({ label: '待办', items: handoff.todos })))
}
