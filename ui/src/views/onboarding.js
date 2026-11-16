import { createElement as h, useState } from 'react'
import { RoomTypeChoices } from '../room/type-choices.js'

export function Onboarding({ state, archived = [], onRestore, onCreate, onSample }) {
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const disabled = state.phase === 'loading' || state.phase === 'error'
  const openSample = async () => {
    if (sampleBusy || typeof onSample !== 'function') return
    setSampleBusy(true)
    setSampleError('')
    const result = await onSample()
    setSampleBusy(false)
    if (result?.ok !== true) setSampleError(result?.error ?? '示例房间没能打开')
  }
  const errorText = state.runtime?.ok === false
    ? `Lodge 服务未连接：${state.runtime.error}`
    : state.phase === 'error'
      ? `没连上 Lodge：${state.error}`
      : ''
  return h('div', { className: 'crew-onboarding' },
    h('div', { className: 'crew-onboarding-card' },
      h('img', { className: 'crew-onboarding-logo', src: './logo.svg', alt: 'Lodge', width: 96, height: 96 }),
      h('h1', null, 'Lodge'),
      h('p', null, '把一件事交给一个房间。目标、过程、结果，都留在里面。'),
      h(RoomTypeChoices, { disabled, onPick: onCreate }),
      onSample === undefined
        ? null
        : h('div', { className: 'crew-onboarding-sample' },
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: disabled || sampleBusy,
            onClick: () => void openSample(),
          }, sampleBusy ? '正在打开示例…' : '先看一间完成的示例房间'),
          h('p', { className: 'crew-field-hint' }, '不用配置，直接看结果和工作记录。')),
      sampleError === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, sampleError),
      archived.length === 0 || typeof onRestore !== 'function'
        ? null
        : h('div', { className: 'crew-onboarding-archived' },
          h('p', { className: 'crew-field-hint' }, '已归档的房间'),
          ...archived.map(room => h('button', {
            key: room.id,
            type: 'button',
            className: 'crew-ghost',
            onClick: () => void onRestore(room.id),
          }, `恢复「${room.name}」`))),
      state.phase === 'loading' ? h('p', { className: 'crew-field-hint', role: 'status' }, '正在连接 Lodge…') : null,
      errorText === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, errorText)))
}
