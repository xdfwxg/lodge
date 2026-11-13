import { createElement as h } from 'react'

// Adapted from Fei2411/DS-Bot, ds-bot/src/client/icons.js (Apache-2.0).
export const ChevronDownIcon = () => h('svg', {
  width: 14,
  height: 14,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}, h('path', { d: 'M5 7.5L10 12.5L15 7.5' }))

export const CheckIcon = () => h('svg', {
  width: 14,
  height: 14,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}, h('path', { d: 'M4.5 10.5l3.5 3.5 7.5-8' }))
