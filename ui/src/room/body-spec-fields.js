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

// 角色成员的能力只读：技能是角色包，MCP 是成员授权，都不在这里改。
// 内置只读浏览器不可编辑，但仍然要让人看见它确实在身上。
export function CapabilityReadOnly({ skills = [], mcp = [], note = '', systemBrowser = false }) {
  const list = Array.isArray(mcp) ? mcp : []
  const servers = list
    .map(item => (typeof item === 'string' ? item : item?.server ?? ''))
    .filter(name => name !== '' && name !== BROWSER_MCP_SERVER_NAME)
  const browser = systemBrowser || list.some(item => (
    (typeof item === 'string' ? item : item?.server) === BROWSER_MCP_SERVER_NAME
  ))
  return h('div', { className: 'crew-capability crew-capability-readonly' },
    h('div', { className: 'crew-capability-head' },
      h('b', null, '能力'),
      note === '' ? null : h('span', { className: 'crew-capability-note' }, note)),
    h('div', { className: 'crew-capability-row' },
      h('span', { className: 'crew-capability-label' }, '技能'),
      h('span', { className: 'crew-capability-chips' },
        (Array.isArray(skills) ? skills : []).map(name => h('code', { key: name }, name)))),
    h('div', { className: 'crew-capability-row' },
      h('span', { className: 'crew-capability-label' }, '工具连接'),
      h('span', { className: 'crew-capability-chips' },
        browser
          ? h('code', { key: 'browser', className: 'crew-capability-system' }, '只读浏览器（系统）')
          : null,
        ...servers.map(name => h('code', { key: name }, name)),
        !browser && servers.length === 0
          ? h('span', { className: 'crew-capability-empty' }, '没有额外工具连接')
          : null)))
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

