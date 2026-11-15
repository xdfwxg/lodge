import { createElement as h } from 'react'
import { ActivityLine } from '../../message-cards.js'
import { describeSteps } from './transcript-model.js'

// 连续工具步骤收成一行；展开后逐步复用现有的活动行，不引入新的 pill 皮肤。
export function StepGroup({ steps, live = false }) {
  return h('details', { className: 'crew-steps', open: live === true ? true : undefined },
    h('summary', null,
      h('span', { className: 'crew-steps-count' }, describeSteps(steps)),
      h('span', { className: 'crew-steps-hint' }, live ? '正在做' : '展开')),
    h('div', { className: 'crew-steps-list' },
      steps.map(step => h(ActivityLine, { key: step.id, message: step }))))
}
