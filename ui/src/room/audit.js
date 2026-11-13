import { createElement as h } from 'react'

// 审计详情是排障视图，不是主流程；默认关闭，按需打开。
export function AuditDrawer({ open, onClose, children }) {
  if (open !== true) return null
  return h('div', { className: 'crew-audit-overlay', onClick: onClose },
    h('aside', {
      className: 'crew-audit-drawer',
      'aria-label': '审计详情',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-audit-head' },
      h('b', null, '审计详情'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: onClose }, '关闭')),
    h('div', { className: 'crew-audit-body' }, children)))
}
