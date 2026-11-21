import { createElement as h } from 'react'

const ACTION_LABELS = {
  approval: '去确认',
  decision: '去确认',
  signoff: '去确认',
  review: '去看看',
  question: '去回答',
  error: '去处理',
  connection: '去处理',
  mcp: '去处理',
  blocked: '去处理',
  setup: '去处理',
  rework: '去处理',
  merge: '去处理',
  parallel: '去处理',
}

// 例行工作的那一次停下来等人时，提醒落在目标房，不把人直接送进隐藏的 run 房。
export function RunNeedsCard({ needs, onOpenRun = null }) {
  if (needs === null || needs === undefined) return null
  return h('div', { className: 'crew-routine-needs', role: 'status' },
    h('p', { className: 'crew-routine-needs-title' }, needs.label ?? '待处理'),
    needs.reason ? h('p', { className: 'crew-routine-needs-reason' }, needs.reason) : null,
    needs.detail ? h('p', { className: 'crew-field-hint' }, needs.detail) : null,
    needs.runId && onOpenRun
      ? h('button', {
        type: 'button',
        className: 'crew-link',
        onClick: () => onOpenRun(needs.runId),
      }, ACTION_LABELS[needs.action] ?? '去处理')
      : null)
}
