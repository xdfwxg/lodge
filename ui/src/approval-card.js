import { createElement as h } from 'react'

// 外部动作审批卡：只展示事实与两个决定，不把“模型说可以”当成批准。
export function ApprovalCard({ approval, onDecide }) {
  return h('div', { className: 'crew-card crew-approval' },
    h('div', { className: 'crew-card-head' },
      h('span', null, '有个操作要你点头'),
      h('span', { className: 'crew-verdict', 'data-pending': '' }, approval.label)),
    h('div', { className: 'crew-card-body' },
      h('div', { className: 'crew-kv' },
        h('span', null, '谁'),
        h('span', null, approval.seatName)),
      h('div', { className: 'crew-kv' },
        h('span', null, '要做什么'),
        h('code', { className: 'crew-code' }, approval.summary)),
      approval.gate
        ? h('div', { className: 'crew-approval-gate', 'data-decision': approval.gate.decision },
          h('b', null, approval.gate.decision === 'deny'
            ? '预检：建议拒绝'
            : approval.gate.decision === 'review'
              ? '预检：需你判断'
              : '预检：可放行'),
          approval.gate.reasons?.length
            ? h('span', null, ` · ${approval.gate.reasons.join('、')}`)
            : null)
        : null,
      approval.gateAgent
        ? h('div', { className: 'crew-approval-gate', 'data-decision': approval.gateAgent.decision },
          h('b', null, approval.gateAgent.error === true
            ? '第二意见：不可用'
            : approval.gateAgent.decision === 'deny'
              ? '第二意见：建议拒绝'
              : approval.gateAgent.decision === 'review'
                ? '第二意见：需你判断'
                : '第二意见：可放行'),
          approval.gateAgent.reasons?.length
            ? h('span', null, ` · ${approval.gateAgent.reasons.join('、')}`)
            : null)
        : null),
    h('div', { className: 'crew-card-foot' },
      h('span', { className: 'crew-req-note' }, '你点头之前，Lodge 不会动手'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => onDecide('deny') }, '先别做'),
      h('button', { type: 'button', className: 'crew-accept', onClick: () => onDecide('allow') }, '可以做')))
}
