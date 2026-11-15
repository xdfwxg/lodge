import { createElement as h } from 'react'

export function IntakeSection({ label, items, warning = false }) {
  if (items.length === 0) return null
  return h('div', { className: `crew-handoff-section${warning ? ' is-warning' : ''}` },
    h('b', null, label),
    h('ul', null, items.map((item, index) => h('li', { key: `${label}-${index}` }, item))))
}
