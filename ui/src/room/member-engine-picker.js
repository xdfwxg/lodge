import { Fragment, createElement as h } from 'react'

import { ROLE_LABEL, modelRowsFor } from './member-options.js'

// 成员引擎/模型/性格是两种房型共用的小组件；表单本身归各自上下文。
export function MemberEnginePicker({
  members,
  choices,
  setChoices,
  engines = [],
  loginBusy = false,
  personalities = [],
  allowCapabilities = false,
  allowSkills = false,
  onRemove = null,
  canRemove = false,
  canRemoveMember = null,
  onLogin = () => {},
  onInteraction = () => {},
}) {
  const engineChoices = engines.filter(item => item.available)
  const withPersona = personalities.length > 0
  return h(Fragment, null,
    withPersona
      ? h('div', { className: 'crew-member-columns', 'aria-hidden': 'true' },
        h('span', null, '成员'),
        h('span', null, '性格'),
        h('span', null, '模型'),
        h('span', null))
      : h('div', { className: 'crew-member-columns crew-member-columns-plain', 'aria-hidden': 'true' },
        h('span', null, '成员'),
        h('span', null, '模型')),
    ...members.map((member, index) => {
      const choice = choices[index] ?? { engine: '', model: '' }
      const engine = engineChoices.find(item => item.id === choice.engine)
      const rows = modelRowsFor(engine)
      const model = choice.model !== '' ? choice.model : (engine?.models?.default || rows[0]?.id || '')
      const personalityId = choice.personality || member.personality || personalities[index % Math.max(1, personalities.length)]?.id || ''
      return h('div', { key: `${member.role}-${index}`, className: `crew-member-engine ${withPersona ? 'crew-member-with-persona' : 'crew-member-with-model'}` },
        h('div', { className: 'crew-member-engine-head' },
          h('span', null, member.name === undefined || member.name === '' ? ROLE_LABEL[member.role] ?? member.role : member.name)),
        personalities.length === 0
          ? null
          : h('select', {
            className: 'crew-member-menu crew-member-personality',
            'aria-label': `${member.name ?? member.role}的性格`,
            value: personalityId,
            onChange: event => {
              const next = [...choices]
              next[index] = { ...choice, personality: event.target.value }
              setChoices(next)
              onInteraction()
            },
          },
          personalities.map(item => h('option', { key: item.id, value: item.id }, item.label))),
        h('div', { className: 'crew-member-engine-controls' },
          h('select', {
            className: 'crew-member-menu',
            'aria-label': `${member.name ?? member.role}的模型服务`,
            value: choice.engine,
            onChange: event => {
              const next = [...choices]
              next[index] = { engine: event.target.value, model: '', personality: choice.personality || member.personality || '' }
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
              className: 'crew-member-menu',
              'aria-label': `${member.name ?? member.role}的模型`,
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
            : null,
          engine !== undefined && rows.length === 0
            ? h('p', { className: 'crew-field-hint crew-member-hint' }, '这个模型服务还没有可用模型。')
            : null),
        allowCapabilities
          ? h('details', { className: 'crew-member-capabilities' },
            h('summary', null, allowSkills ? '技能 / 外部工具' : '外部工具'),
            allowSkills
              ? h('input', {
                className: 'crew-goal-input',
                value: choice.skillsText ?? '',
                placeholder: '技能名，用逗号分隔',
                'aria-label': `${member.name ?? member.role}的技能`,
                onChange: event => {
                  const next = [...choices]
                  next[index] = { ...choice, skillsText: event.target.value }
                  setChoices(next)
                  onInteraction()
                },
              })
              : null,
            h('input', {
              className: 'crew-goal-input',
              value: choice.mcpText ?? '',
              placeholder: 'MCP 服务名，用逗号分隔',
              'aria-label': `${member.name ?? member.role}的外部工具`,
              onChange: event => {
                const next = [...choices]
                next[index] = { ...choice, mcpText: event.target.value }
                setChoices(next)
                onInteraction()
              },
            }))
          : null,
        canRemove && typeof onRemove === 'function' && (canRemoveMember === null || canRemoveMember(member, index))
          ? h('button', {
            type: 'button',
            className: 'crew-member-remove',
            'aria-label': `移除成员 ${member.name ?? member.role}`,
            title: '移除成员',
            onClick: () => onRemove(member, index),
          }, '×')
          : null)
  }))
}
