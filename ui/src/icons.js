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


export const TargetIcon = () => h('svg', {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}, [
  h('circle', { key: 'outer', cx: 10, cy: 10, r: 6.5 }),
  h('circle', { key: 'inner', cx: 10, cy: 10, r: 2.2 }),
])






export const ArrowRightIcon = () => h('svg', {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}, h('path', { d: 'M4 10h12M11 5l5 5-5 5' }))
