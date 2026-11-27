import { createElement as h } from 'react'
import { cardActionsOf } from '../../shared/attempt.js'

const CONSEQUENCE = {
  install: '会安装到这台电脑',
  push: '会改远端仓库',
  delete: '删了找不回来',
  message: '会发到房间外',
  privilege: '会用更高权限执行',
  network: '会访问外部服务',
  change: '会改动这间房',
}

const GATE_NOTE = { review: '请确认一下', deny: '我不建议' }

const firstLine = text => String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? ''

// 外部动作审批卡：成员在等一句答复，不是系统告警。
// 先说他想要什么，再说会动到什么；命令是细节，折起来，不占主视线。
export function ApprovalCard({ approval, onDecide, state = 'pending' }) {
  const actions = cardActionsOf({ kind: 'approval', state })
  const gate = approval.gate ?? null
  const target = String(approval.target ?? '').trim() || firstLine(approval.summary)
  const command = String(approval.command ?? '').trim()
  const showCommand = command !== '' && command !== target
  const consequence = CONSEQUENCE[approval.kind] ?? ''
  const gateNote = gate === null ? '' : (GATE_NOTE[gate.decision] ?? '')
  // 系统不建议做时，把“先别做”放成主按钮；不要让危险动作最显眼。
  const denyFirst = gate?.decision === 'deny'
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
        `想${approval.label}`)),
    h('div', { className: 'crew-approval-body' },
      target === '' ? null : h('div', { className: 'crew-approval-target' }, target),
      consequence === '' && gateNote === ''
        ? null
        : h('div', { className: 'crew-approval-meta' },
          consequence === '' ? null : h('span', null, consequence),
          gateNote === ''
            ? null
            : h('span', { className: 'crew-approval-gate', 'data-decision': gate.decision }, gateNote)),
      showCommand
        ? h('details', { className: 'crew-fold crew-approval-more' },
          h('summary', null, '看命令'),
          h('pre', { className: 'crew-code' }, command))
        : null),
    h('div', { className: 'crew-approval-foot' },
      actions.length === 0
        ? h('span', { className: 'crew-approval-note' }, '这张确认已经失效。')
        : null,
      actions.includes('deny')
        ? h('button', { type: 'button', className: denyFirst ? 'crew-accept' : 'crew-ghost', onClick: () => onDecide('deny') }, '先别做')
        : null,
      actions.includes('allow')
        ? h('button', { type: 'button', className: denyFirst ? 'crew-ghost' : 'crew-accept', onClick: () => onDecide('allow') }, '可以做')
        : null))
}
