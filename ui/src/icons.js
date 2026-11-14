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


export const FolderIcon = () => h('svg', {
  width: 16,
  height: 16,
  viewBox: '0 0 20 20',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}, h('path', { d: 'M3 6.5A2.5 2.5 0 0 1 5.5 4h3L10 6h4.5A2.5 2.5 0 0 1 17 8.5v5A2.5 2.5 0 0 1 14.5 16h-9A2.5 2.5 0 0 1 3 13.5z' }))


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
