import { createElement as h } from 'react'
import { cardActionsOf } from '../../shared/attempt.js'

// 外部动作审批卡：只展示事实与两个决定，不把“模型说可以”当成批准。
export function ApprovalCard({ approval, onDecide, state = 'pending' }) {
  const actions = cardActionsOf({ kind: 'approval', state })
  return h('div', {
    className: 'crew-card crew-approval',
    'data-card-state': state,
    'data-room-decision': state === 'pending' ? '' : undefined,
  },
    h('div', { className: 'crew-card-head' },
      h('span', null, '要你确认'),
      h('span', { className: 'crew-verdict', 'data-pending': '' }, approval.label)),
    h('div', { className: 'crew-card-body' },
      h('div', { className: 'crew-kv' },
        h('span', null, '谁'),
        h('span', null, approval.memberName)),
      h('div', { className: 'crew-kv' },
        h('span', null, '要做什么'),
        h('code', { className: 'crew-code' }, approval.summary)),
      approval.command && approval.command !== approval.summary
        ? h('details', { className: 'crew-fold' },
          h('summary', null, '完整命令'),
          h('pre', { className: 'crew-code' }, approval.command))
        : null,
      approval.gate
        ? h('div', { className: 'crew-approval-gate', 'data-decision': approval.gate.decision },
          h('b', null, approval.gate.decision === 'deny'
            ? '建议先别做'
            : approval.gate.decision === 'review'
              ? '拿不准'
              : '看起来可以做'),
          approval.gate.reasons?.length
            ? h('span', null, ` · ${approval.gate.reasons.join('、')}`)
            : null)
        : null),
    h('div', { className: 'crew-card-foot' },
      h('span', { className: 'crew-req-note' }, actions.length === 0 ? '这张确认已经失效。' : '你决定之前，Lodge 不动手。'),
      actions.includes('deny')
        ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => onDecide('deny') }, '先别做')
        : null,
      actions.includes('allow')
        ? h('button', { type: 'button', className: 'crew-accept', onClick: () => onDecide('allow') }, '可以做')
        : null))
}
