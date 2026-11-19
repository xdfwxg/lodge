import { createElement as h } from 'react'
import { BROWSER_MCP_SERVER_NAME } from '../../../shared/browser-mcp.js'

const listText = list => (Array.isArray(list) ? list : [])
  .map(item => (typeof item === 'string' ? item : item?.server ?? ''))
  .filter(Boolean)
  .join(', ')

// 只读浏览器是系统标配，不出现在可编辑的 MCP 列表里。
const mcpText = list => (Array.isArray(list) ? list : [])
  .filter(item => (typeof item === 'string' ? item : item?.server) !== BROWSER_MCP_SERVER_NAME)
  .map(item => (typeof item === 'string' ? item : item?.server ?? ''))
  .filter(Boolean)
  .join(', ')

export const bodySpecOf = (member = {}) => {
  const spec = member.body?.spec ?? {}
  return {
    prompt: typeof spec.prompt === 'string' ? spec.prompt : '',
    skillsText: listText(spec.skills),
    mcpText: mcpText(spec.mcp),
  }
}

export const bodySpecPayload = spec => {
  const skills = String(spec.skillsText ?? '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
  const mcp = String(spec.mcpText ?? '').split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
  return { prompt: spec.prompt ?? '', skills, mcp }
}

// 能力是 skills 和 mcp，放在一组里；它们不改性格。
export function CapabilityFields({ value, onChange, disabled = false, showSkills = true }) {
  const update = patch => onChange({ ...value, ...patch })
  return h('div', { className: 'crew-capability' },
    h('div', { className: 'crew-capability-head' },
      h('b', null, '能力')),
    showSkills
      ? h('label', { className: 'crew-capability-row' },
        h('span', { className: 'crew-capability-label' }, 'skills'),
        h('input', {
          className: 'crew-capability-input',
          type: 'text',
          'aria-label': 'skills',
          placeholder: '代码审查、写测试',
          value: value.skillsText ?? '',
          disabled,
          onChange: event => update({ skillsText: event.target.value }),
        }))
      : null,
    h('label', { className: 'crew-capability-row' },
      h('span', { className: 'crew-capability-label' }, 'mcp'),
      h('input', {
        className: 'crew-capability-input',
        type: 'text',
        'aria-label': 'mcp',
        placeholder: '搜索、知识库',
        value: value.mcpText ?? '',
        disabled,
        onChange: event => update({ mcpText: event.target.value }),
      })))
}

