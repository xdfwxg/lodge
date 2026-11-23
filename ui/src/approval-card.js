import { createElement as h } from 'react'
import { cardActionsOf } from '../../shared/attempt.js'

const GATE_LABEL = { allow: '看起来可以做', review: '拿不准', deny: '建议先别做' }

// 外部动作审批卡：只展示事实与决定，不把“模型说可以”当成批准。
// 它是成员在等一句答复，不是系统告警：说清谁想做什么，只留两个决定。
export function ApprovalCard({ approval, onDecide, state = 'pending' }) {
  const actions = cardActionsOf({ kind: 'approval', state })
  const gate = approval.gate ?? null
  return h('div', {
    className: 'crew-card crew-approval',
    'data-card-state': state,
    'data-room-decision': state === 'pending' ? '' : undefined,
    role: 'group',
    'aria-label': '要你确认的操作',
  },
    h('div', { className: 'crew-approval-head' },
      h('span', { className: 'crew-approval-dot', 'data-decision': gate?.decision ?? 'review', 'aria-hidden': 'true' }),
      h('span', { className: 'crew-approval-say' },
        h('b', null, approval.memberName),
        `想${approval.label}`),
      h('span', { className: 'crew-approval-flag' }, '要你确认')),
    h('div', { className: 'crew-approval-body' },
      h('code', { className: 'crew-approval-command' }, approval.summary),
      approval.command && approval.command !== approval.summary
        ? h('details', { className: 'crew-fold crew-approval-more' },
          h('summary', null, '完整命令'),
          h('pre', { className: 'crew-code' }, approval.command))
        : null,
      gate === null
        ? null
        : h('div', { className: 'crew-approval-gate', 'data-decision': gate.decision },
          h('span', null, GATE_LABEL[gate.decision] ?? GATE_LABEL.review),
          gate.reasons?.length
            ? h('span', { className: 'crew-approval-reasons' }, ` · ${gate.reasons.join('、')}`)
            : null)),
    h('div', { className: 'crew-approval-foot' },
      actions.length === 0
        ? h('span', { className: 'crew-approval-note' }, '这张确认已经失效。')
        : null,
      actions.includes('deny')
        ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => onDecide('deny') }, '先别做')
        : null,
      actions.includes('allow')
        ? h('button', { type: 'button', className: 'crew-accept', onClick: () => onDecide('allow') }, '可以做')
        : null))
}
