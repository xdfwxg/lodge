import { createElement as h } from 'react'

// A room header pill that only shows what the room is and where it stands.
// Room-specific modules translate their own state into these plain props.
export function Island({ title, status, tone = 'active', icon = null, titleText, detail = null, footer = null }) {
  const expanded = detail !== null || footer !== null
  return h('div', { className: 'crew-island-wrap' },
    h('div', {
      className: 'crew-island',
      'data-tone': tone,
      'data-expanded': expanded ? 'true' : undefined,
      title: titleText,
    },
    h('div', { className: 'crew-island-row' },
      icon === null ? null : h('span', { className: 'crew-island-ico', 'aria-hidden': 'true' }, icon),
      h('span', { className: 'crew-island-title' }, title),
      status ? h('span', { className: 'crew-island-status', role: 'status' }, status) : null),
    detail === null ? null : h('div', { className: 'crew-island-detail' }, detail),
    footer === null ? null : h('div', { className: 'crew-island-foot' }, footer)))
}
