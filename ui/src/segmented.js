import { createElement as h } from 'react'

// 两三个互斥选项的滑动开关：选中块自己移过去，文字不闪。
export function Segmented({ label, options = [], value, onChange = () => {}, disabled = false, className = '' }) {
  const index = Math.max(0, options.findIndex(item => item.value === value))
  return h('div', {
    className: `crew-seg ${className}`.trim(),
    role: 'group',
    'aria-label': label,
    style: { '--seg-count': Math.max(1, options.length), '--seg-index': index },
  },
  h('span', { className: 'crew-seg-thumb', 'aria-hidden': true }),
  options.map(item => h('button', {
    key: item.value,
    type: 'button',
    className: 'crew-seg-item',
    'aria-pressed': item.value === value,
    disabled,
    onClick: () => onChange(item.value),
  }, item.label)))
}
