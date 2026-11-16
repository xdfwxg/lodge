import { createElement as h } from 'react'

// Shared empty / waiting / error surface: one typographic hierarchy for all three.
export function StatePanel({ title, body, tone = 'neutral', action = null }) {
  return h('div', { className: 'crew-state', 'data-tone': tone },
    h('div', { className: 'crew-state-mark', 'aria-hidden': 'true' }),
    h('div', { className: 'crew-state-copy' },
      h('b', { className: 'crew-state-title' }, title),
      body === undefined || body === null || body === '' ? null : h('p', { className: 'crew-state-body' }, body)),
    action ?? null)
}
