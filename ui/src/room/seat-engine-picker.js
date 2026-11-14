import { createElement as h } from 'react'

import { ROLE_LABEL, modelRowsFor } from './seat-options.js'

// 席位引擎/模型选择是两种房型共用的小组件；表单本身归各自上下文。
export function SeatEnginePicker({
  seats,
  choices,
  setChoices,
  engines = [],
  loginBusy = false,
  onLogin = () => {},
  onInteraction = () => {},
}) {
  const engineChoices = engines.filter(item => item.available)
  return seats.map((seat, index) => {
    const choice = choices[index] ?? { engine: '', model: '' }
    const engine = engineChoices.find(item => item.id === choice.engine)
    const rows = modelRowsFor(engine)
    const model = choice.model !== '' ? choice.model : (engine?.models?.default || rows[0]?.id || '')
    return h('div', { key: `${seat.role}-${index}`, className: 'crew-seat-engine' },
      h('div', { className: 'crew-seat-engine-head' },
        h('span', null, seat.name === undefined || seat.name === '' ? ROLE_LABEL[seat.role] ?? seat.role : seat.name)),
      h('div', { className: 'crew-seat-engine-controls' },
        h('select', {
          className: 'crew-goal-input',
          value: choice.engine,
          onChange: event => {
            const next = [...choices]
            next[index] = { engine: event.target.value, model: '' }
            setChoices(next)
            onInteraction()
          },
        },
        h('option', { value: '' }, '按角色默认'),
        engineChoices.map(item => h('option', {
          key: item.id,
          value: item.id,
        }, `${item.name}${item.models?.default ? ` · ${item.models.default}` : ' · 未配置模型'}`))),
        engine !== undefined && rows.length > 0
          ? h('select', {
            className: 'crew-goal-input',
            value: model,
            onChange: event => {
              const next = [...choices]
              next[index] = { ...choice, model: event.target.value }
              setChoices(next)
            },
          },
          rows.map(item => h('option', { key: item.id, value: item.id }, item.label)))
          : null,
        engine !== undefined && rows.length === 0 && Array.isArray(engine.login?.args)
          ? h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: loginBusy,
            onClick: () => void onLogin(engine),
          }, loginBusy ? '正在打开…' : `登录 ${engine.name ?? engine.id}`)
          : null),
      engine !== undefined && rows.length === 0
        ? h('p', { className: 'crew-field-hint' }, '这个引擎还没有可用模型。')
        : null)
  })
}

