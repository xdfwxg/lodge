import { Fragment, createElement as h } from 'react'

import { ROLE_LABEL, modelRowsFor } from './seat-options.js'

// 席位引擎/模型/性格是两种房型共用的小组件；表单本身归各自上下文。
export function SeatEnginePicker({
  seats,
  choices,
  setChoices,
  engines = [],
  loginBusy = false,
  personalities = [],
  onRemove = null,
  canRemove = false,
  onLogin = () => {},
  onInteraction = () => {},
}) {
  const engineChoices = engines.filter(item => item.available)
  return h(Fragment, null, ...seats.map((seat, index) => {
    const choice = choices[index] ?? { engine: '', model: '' }
    const engine = engineChoices.find(item => item.id === choice.engine)
    const rows = modelRowsFor(engine)
    const model = choice.model !== '' ? choice.model : (engine?.models?.default || rows[0]?.id || '')
    const personalityId = choice.personality || seat.personality || personalities[index % Math.max(1, personalities.length)]?.id || ''
    return h('div', { key: `${seat.role}-${index}`, className: 'crew-seat-engine' },
      h('div', { className: 'crew-seat-engine-head' },
        h('span', null, seat.name === undefined || seat.name === '' ? ROLE_LABEL[seat.role] ?? seat.role : seat.name)),
      h('div', { className: 'crew-seat-engine-controls' },
        h('select', {
          className: 'crew-seat-menu',
          'aria-label': `${seat.name ?? seat.role}的引擎`,
          value: choice.engine,
          onChange: event => {
            const next = [...choices]
            next[index] = { engine: event.target.value, model: '', personality: choice.personality || seat.personality || '' }
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
            className: 'crew-seat-menu',
            'aria-label': `${seat.name ?? seat.role}的模型`,
            value: model,
            onChange: event => {
              const next = [...choices]
              next[index] = { ...choice, model: event.target.value }
              setChoices(next)
            },
          },
          rows.map(item => h('option', { key: item.id, value: item.id }, item.label)))
          : null,
        personalities.length === 0
          ? null
          : h('select', {
            className: 'crew-seat-menu crew-seat-personality',
            'aria-label': `${seat.name ?? seat.role}的性格`,
            value: personalityId,
            onChange: event => {
              const next = [...choices]
              next[index] = { ...choice, personality: event.target.value }
              setChoices(next)
              onInteraction()
            },
          },
          personalities.map(item => h('option', { key: item.id, value: item.id }, item.label))),
        engine !== undefined && rows.length === 0 && Array.isArray(engine.login?.args)
          ? h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: loginBusy,
            onClick: () => void onLogin(engine),
          }, loginBusy ? '正在打开…' : `登录 ${engine.name ?? engine.id}`)
          : null,
        engine !== undefined && rows.length === 0
          ? h('p', { className: 'crew-field-hint crew-seat-hint' }, '这个引擎还没有可用模型。')
          : null),
      canRemove && typeof onRemove === 'function'
        ? h('button', {
          type: 'button',
          className: 'crew-seat-remove',
          'aria-label': `移除成员 ${seat.name ?? seat.role}`,
          title: '移除成员',
          onClick: () => onRemove(seat, index),
        }, '×')
        : null)
  }))
}
