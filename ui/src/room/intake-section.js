import { createElement as h } from 'react'

export function IntakeSection({ label, items, warning = false, empty = null }) {
  if (items.length === 0 && empty === null) return null
  return h('div', { className: `crew-handoff-section${warning && items.length > 0 ? ' is-warning' : ''}` },
    h('b', null, label),
    items.length === 0
      ? h('p', { className: 'crew-field-hint' }, empty)
      : h('ul', null, items.map((item, index) => h('li', { key: `${label}-${index}` }, item))))
}
