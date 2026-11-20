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

export const PlusIcon = () => h('svg', {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
}, h('path', { d: 'M10 4.5v11M4.5 10h11' }))

export const StopIcon = () => h('svg', {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'currentColor',
}, h('rect', { x: 5.5, y: 5.5, width: 9, height: 9, rx: 2.4 }))

export const ArrowDownIcon = () => h('svg', {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}, h('path', { d: 'M10 5v10M5.5 10.5L10 15l4.5-4.5' }))


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






const roleBase = {
  width: 14,
  height: 14,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const PlannerIcon = () => h('svg', roleBase, [
  h('path', { key: 'route', d: 'M5 16V11a4 4 0 0 1 4-4h6' }),
  h('path', { key: 'head', d: 'M12.5 4.5L15 7l-2.5 2.5' }),
  h('circle', { key: 'start', cx: 5, cy: 16, r: 1.1 }),
])

export const ExecutorIcon = () => h('svg', roleBase, [
  h('rect', { key: 'screen', x: 3, y: 4.5, width: 14, height: 11, rx: 2.4 }),
  h('path', { key: 'prompt', d: 'M6.5 8.5l2.2 2.2-2.2 2.2' }),
  h('path', { key: 'cursor', d: 'M11 13h3' }),
])

export const VerifierIcon = () => h('svg', roleBase, [
  h('circle', { key: 'ring', cx: 10, cy: 10, r: 6.8 }),
  h('path', { key: 'check', d: 'M7 10.2l2.1 2.1 4-4.3' }),
])

export const PersonIcon = () => h('svg', roleBase, [
  h('circle', { key: 'head', cx: 10, cy: 7.4, r: 2.7 }),
  h('path', { key: 'body', d: 'M4.8 16c.6-3 2.7-4.8 5.2-4.8s4.6 1.8 5.2 4.8' }),
])
