import { Fragment, createElement as h } from 'react'

import { engineBlockLabel, engineBlockReason } from '../../../shared/engine-readiness.js'
import { ROLE_LABEL, modelRowsFor } from './member-options.js'

// 选择列表可能比成员列表短：补齐空洞，避免后面的渲染读到 undefined。
const replaceChoice = (choices, index, value) => Array.from(
  { length: Math.max(choices.length, index + 1) },
  (_, position) => (position === index ? value : choices[position] ?? { engine: '', model: '' }),
)

// 成员引擎/模型/性格是两种房型共用的小组件；表单本身归各自上下文。
export function MemberEnginePicker({
  members,
  choices,
  setChoices,
  engines = [],
  personalities = [],
  allowCapabilities = false,
  allowSkills = false,
  allowVoice = false,
  requireApprovalGate = false,
  onRemove = null,
  canRemove = false,
  canRemoveMember = null,
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
      const execRole = member.permissions?.exec ?? ['worker', 'executor', 'verifier'].includes(member.role)
      const needsGate = requireApprovalGate === true && execRole === true
      const engine = engineChoices.find(item => item.id === choice.engine)
      const rows = modelRowsFor(engine)
      const model = choice.model !== '' ? choice.model : (engine?.models?.default || rows[0]?.id || '')
      const personalityId = choice.personality || member.personality || personalities[index % Math.max(1, personalities.length)]?.id || ''
      return h(Fragment, { key: `${member.role}-${index}` },
        h('div', { className: `crew-member-engine ${withPersona ? 'crew-member-with-persona' : 'crew-member-with-model'}` },
        h('div', { className: 'crew-member-engine-head' },
          h('span', null, member.name === undefined || member.name === '' ? ROLE_LABEL[member.role] ?? member.role : member.name)),
        personalities.length === 0
          ? null
          : h('select', {
            className: 'crew-member-menu crew-member-personality',
            'aria-label': `${member.name ?? member.role}的性格`,
            value: personalityId,
            onChange: event => {
              setChoices(replaceChoice(choices, index, { ...choice, personality: event.target.value }))
              onInteraction()
            },
          },
          personalities.map(item => h('option', { key: item.id, value: item.id }, item.label))),
        h('div', { className: 'crew-member-engine-controls' },
          h('select', {
            className: 'crew-member-menu',
            'aria-label': `${member.name ?? member.role}的 模型服务`,
            value: choice.engine,
            onChange: event => {
              setChoices(replaceChoice(choices, index, { engine: event.target.value, model: '', personality: choice.personality || member.personality || '' }))
              onInteraction()
            },
          },
          h('option', { value: '' }, '按角色默认'),
          engineChoices.map(item => {
            const reason = engineBlockReason(item, { requireApproval: needsGate })
            const modelLabel = item.models?.default
              ? ` · ${item.models.default}`
              : reason === '' ? ' · 未配置模型' : ''
            return h('option', {
              key: item.id,
              value: item.id,
              disabled: reason !== '',
            }, `${item.name}${modelLabel}${reason === '' ? '' : ` · ${engineBlockLabel(reason)}`}`)
          })),
          engine !== undefined && rows.length > 0
            ? h('select', {
              className: 'crew-member-menu',
              'aria-label': `${member.name ?? member.role}的模型`,
              value: model,
              onChange: event => {
                setChoices(replaceChoice(choices, index, { ...choice, model: event.target.value }))
              },
            },
            rows.map(item => h('option', { key: item.id, value: item.id }, item.label)))
            : null,
          engine !== undefined && rows.length === 0
            ? h('p', { className: 'crew-field-hint crew-member-hint' }, '这个 模型服务还没有可用模型。')
            : null,
          engine !== undefined && engine.authenticated !== false && needsGate === true && engine.capabilities?.approvalReview !== true
            ? h('p', { className: 'crew-field-hint crew-member-hint' }, '这个模型不会先问你，不能用来执行。换一个会先问你的模型。')
            : null),
        allowCapabilities
          ? h('details', { className: 'crew-member-capabilities' },
            h('summary', null, allowSkills ? '技能 / 工具连接' : '工具连接'),
            allowSkills
              ? h('input', {
                className: 'crew-goal-input',
                value: choice.skillsText ?? '',
                placeholder: '技能名，用逗号分隔',
                'aria-label': `${member.name ?? member.role}的技能`,
                onChange: event => {
                  setChoices(replaceChoice(choices, index, { ...choice, skillsText: event.target.value }))
                  onInteraction()
                },
              })
              : null,
            h('input', {
              className: 'crew-goal-input',
              value: choice.mcpText ?? '',
              placeholder: '工具连接名，用逗号分隔',
              'aria-label': `${member.name ?? member.role}的工具连接`,
              onChange: event => {
                setChoices(replaceChoice(choices, index, { ...choice, mcpText: event.target.value }))
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
          : null),
        allowVoice
          ? h('label', { className: 'crew-member-voice' },
            h('span', null, '说话习惯'),
            h('input', {
              className: 'crew-goal-input crew-member-voice-input',
              type: 'text',
              maxLength: 30,
              value: choice.voice ?? member.voice ?? '',
              placeholder: '一句话：他平时怎么说话、先问什么（可留空）',
              'aria-label': `${member.name ?? member.role}的说话习惯`,
              onChange: event => {
                setChoices(replaceChoice(choices, index, { ...choice, voice: event.target.value }))
                onInteraction()
              },
            }))
          : null)
  }))
}
