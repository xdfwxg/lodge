import { Fragment, createElement as h } from 'react'

const listText = list => (Array.isArray(list) ? list : [])
  .map(item => (typeof item === 'string' ? item : item?.server ?? ''))
  .filter(Boolean)
  .join(', ')

export const bodySpecOf = (member = {}) => {
  const spec = member.body?.spec ?? {}
  return {
    prompt: typeof spec.prompt === 'string' ? spec.prompt : '',
    skillsText: listText(spec.skills),
    mcpText: listText(spec.mcp),
  }
}

export const bodySpecPayload = spec => {
  const skills = String(spec.skillsText ?? '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
  const mcp = String(spec.mcpText ?? '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
  return { prompt: spec.prompt ?? '', skills, mcp }
}

// 身体规格：行为说明、技能、MCP；权限和角色仍归成员。
export function CapabilityFields({ value, onChange, disabled = false }) {
  const update = patch => onChange({ ...value, ...patch })
  return h(Fragment, null,
    h('label', { className: 'crew-field crew-body-swap-field' },
      h('b', null, '技能'),
      h('input', {
        className: 'crew-goal-input',
        type: 'text',
        'aria-label': '技能',
        placeholder: '技能名，用逗号分隔',
        value: value.skillsText ?? '',
        disabled,
        onChange: event => update({ skillsText: event.target.value }),
      })),
    h('label', { className: 'crew-field crew-body-swap-field' },
      h('b', null, 'MCP 服务'),
      h('input', {
        className: 'crew-goal-input',
        type: 'text',
        'aria-label': 'MCP 服务',
        placeholder: 'MCP 服务名，用逗号分隔',
        value: value.mcpText ?? '',
        disabled,
        onChange: event => update({ mcpText: event.target.value }),
      })))
}

export function BodySpecFields({ value, onChange, disabled = false, open = false }) {
  const update = patch => onChange({ ...value, ...patch })
  return h('details', { className: 'crew-body-spec', open: open || undefined },
    h('summary', null, '成员设置'),
    h('label', { className: 'crew-field crew-body-swap-field' },
      h('b', null, '行为说明'),
      h('textarea', {
        className: 'crew-goal-input',
        rows: 3,
        'aria-label': '行为说明',
        placeholder: '写给这位成员的长期说明；留空就用角色默认。',
        value: value.prompt ?? '',
        disabled,
        onChange: event => update({ prompt: event.target.value }),
      })),
    h('label', { className: 'crew-field crew-body-swap-field' },
      h('b', null, '技能'),
      h('input', {
        className: 'crew-goal-input',
        type: 'text',
        'aria-label': '技能',
        placeholder: '技能名，用逗号分隔',
        value: value.skillsText ?? '',
        disabled,
        onChange: event => update({ skillsText: event.target.value }),
      })),
    h('label', { className: 'crew-field crew-body-swap-field' },
      h('b', null, 'MCP 服务'),
      h('input', {
        className: 'crew-goal-input',
        type: 'text',
        'aria-label': 'MCP 服务',
        placeholder: 'MCP 服务名，用逗号分隔',
        value: value.mcpText ?? '',
        disabled,
        onChange: event => update({ mcpText: event.target.value }),
      })))
}
