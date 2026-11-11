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
        h('code', { className: 'crew-code' }, approval.summary))),
    h('div', { className: 'crew-card-foot' },
      h('span', { className: 'crew-req-note' }, '只有你点允许，基座才会继续这一步'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => onDecide('deny') }, '拒绝'),
      h('button', { type: 'button', className: 'crew-accept', onClick: () => onDecide('allow') }, '允许')))
}
