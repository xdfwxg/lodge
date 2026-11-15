import { createElement as h } from 'react'
import { timeOf } from '../../view-format.js'
import { displayStepText } from './transcript-model.js'

// 单条工具活动是工作室现场的一拍：不铺开细节，只留动作和时间。
export function StudioStep({ step, live = false }) {
  return h('div', {
    className: 'studio-step',
    'data-live': live ? 'true' : undefined,
    'data-ok': step.meta?.ok !== false,
  },
  h('span', { className: 'studio-step-dot' }),
  h('span', { className: 'studio-step-text' }, displayStepText(step.text)),
  h('span', { className: 'studio-step-time' }, live ? '正在做' : timeOf(step.ts)))
}
