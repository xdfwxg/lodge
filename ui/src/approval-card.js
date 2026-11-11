import { createElement as h } from 'react'

// 外部动作审批卡：只展示事实与两个决定，不把“模型说可以”当成批准。
export function ApprovalCard({ approval, onDecide }) {
  return h('div', { className: 'crew-card crew-approval' },
    h('div', { className: 'crew-card-head' },
      h('span', null, '外部动作等你批准'),
      h('span', { className: 'crew-verdict', 'data-pending': '' }, approval.label)),
    h('div', { className: 'crew-card-body' },
      h('div', { className: 'crew-kv' },
        h('span', null, '席位'),
        h('span', null, approval.seatName)),
      h('div', { className: 'crew-kv' },
        h('span', null, '动作'),
        h('code', { className: 'crew-code' }, approval.summary)),
      approval.gate
        ? h('div', { className: 'crew-approval-gate', 'data-decision': approval.gate.decision },
          h('b', null, approval.gate.decision === 'deny'
            ? '独立守门：建议拒绝'
            : approval.gate.decision === 'review'
              ? '独立守门：需你判断'
              : '独立守门：可放行'),
          approval.gate.reasons?.length
            ? h('span', null, ` · ${approval.gate.reasons.join('、')}`)
            : null)
        : null),
    h('div', { className: 'crew-card-foot' },
      h('span', { className: 'crew-req-note' }, '只有你点允许，基座才会继续这一步'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => onDecide('deny') }, '拒绝'),
      h('button', { type: 'button', className: 'crew-accept', onClick: () => onDecide('allow') }, '允许')))
}
