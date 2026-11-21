import { createElement as h } from 'react'

// 决策卡：一条问题、几行单选、一个明确的继续动作；选项本身说明代价。
export function DecisionCard({
  kicker = '',
  title = '',
  lead = '',
  children,
  footer = null,
  roomDecision = false,
  label = '',
}) {
  return h('section', {
    className: 'crew-decision',
    role: label === '' ? undefined : 'group',
    'aria-label': label === '' ? undefined : label,
    'data-room-decision': roomDecision ? '' : undefined,
  },
    h('div', { className: 'crew-decision-head' },
      kicker === '' ? null : h('span', { className: 'crew-decision-kicker' }, kicker),
      title === '' ? null : h('b', { className: 'crew-decision-title' }, title)),
    lead === '' ? null : h('p', { className: 'crew-decision-lead' }, lead),
    h('div', { className: 'crew-decision-body' }, children),
    footer === null ? null : h('div', { className: 'crew-decision-foot' }, footer))
}

export function DecisionOption({
  selected = false,
  title,
  detail = '',
  badge = '',
  disabled = false,
  onSelect = null,
}) {
  return h('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': selected,
    className: 'crew-decision-option',
    'data-on': selected ? 'true' : undefined,
    disabled,
    onClick: onSelect,
  },
  h('span', { className: 'crew-decision-radio', 'aria-hidden': 'true' }),
  h('span', { className: 'crew-decision-copy' },
    h('span', { className: 'crew-decision-option-title' },
      title,
      badge === '' ? null : h('span', { className: 'crew-decision-badge' }, badge)),
    detail === '' ? null : h('span', { className: 'crew-decision-detail' }, detail)))
}
