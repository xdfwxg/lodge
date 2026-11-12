import { createElement as h } from 'react'

export function Onboarding({ state, onCreate }) {
  return h('div', { className: 'crew-onboarding' },
    h('div', { className: 'crew-onboarding-card' },
      h('img', { className: 'crew-onboarding-logo', src: './logo.svg', alt: 'Lodge', width: 96, height: 96 }),
      h('h1', null, 'Lodge'),
      h('p', null, '创建你的专属房间，召唤一支 AI 小队。'),
      h('div', { className: 'crew-onboarding-actions' },
        h('button', {
          type: 'button',
          className: 'crew-accept',
          disabled: state.phase === 'loading' || state.phase === 'error',
          onClick: onCreate,
        }, '创建房间')),
      state.runtime?.ok === false ? h('p', { className: 'crew-dialog-note' }, `基座未连接：${state.runtime.error}`) : null,
      state.phase === 'error' ? h('p', { className: 'crew-dialog-note' }, `连接失败：${state.error}`) : null,
      state.error ? h('p', { className: 'crew-dialog-note' }, state.error) : null))
}
