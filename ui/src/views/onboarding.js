import { createElement as h } from 'react'
import { RoomTypeChoices } from '../room/type-choices.js'

export function Onboarding({ state, onCreate }) {
  const disabled = state.phase === 'loading' || state.phase === 'error'
  return h('div', { className: 'crew-onboarding' },
    h('div', { className: 'crew-onboarding-card' },
      h('img', { className: 'crew-onboarding-logo', src: './logo.svg', alt: 'Lodge', width: 96, height: 96 }),
      h('h1', null, 'Lodge'),
      h('p', null, '创建你的专属房间，召唤一支 AI 小队。'),
      h(RoomTypeChoices, { disabled, onPick: onCreate }),
      state.runtime?.ok === false ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, `基座未连接：${state.runtime.error}`) : null,
      state.phase === 'error' ? h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, `连接失败：${state.error}`) : null))
}
