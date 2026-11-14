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


export const ChecklistIcon = () => h('svg', {
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
  h('path', { key: 'a', d: 'M3.5 6.2 5 7.7 7.4 5.2' }),
  h('path', { key: 'b', d: 'M10 6.5h6.5' }),
  h('path', { key: 'c', d: 'M3.5 13.6 5 15.1 7.4 12.6' }),
  h('path', { key: 'd', d: 'M10 13.8h6.5' }),
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
