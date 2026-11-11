import { createElement as h } from 'react'

export const ArrowUpIcon = () => h('svg', {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}, h('path', { d: 'M10 15V5M5.5 9.5L10 5l4.5 4.5' }))
