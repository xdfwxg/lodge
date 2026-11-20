import { Fragment, createElement as h, useState } from 'react'
import { EngineLogin, useEngineLogin } from '../engine-login.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'
import { useOverlay } from '../overlay.js'
import { modelRowsFor, roleLabelOf } from './member-options.js'
import { CapabilityFields, bodySpecOf, bodySpecPayload } from './body-spec-fields.js'
import { bodyCapabilitiesOf } from '../../../shared/body-capabilities.js'
import { roleDefinitionOf } from '../../../shared/role-definitions.js'
import { Segmented } from '../segmented.js'

const MIND_PRESETS = [
  { id: 'rigorous', label: '严谨', prompt: '先核对事实与证据，指出不确定的地方；不轻易下结论。' },
  { id: 'decisive', label: '果断', prompt: '先给判断和推荐答案，再补理由；不绕弯。' },
  { id: 'gentle', label: '温和', prompt: '先理解对方，再提出不同意见；语气克制，不压人。' },
  { id: 'critical', label: '挑刺', prompt: '主动找反例、漏洞和风险；宁可多问一句，不放过疑点。' },
]

const labelOf = engine => `${engine.name ?? engine.id}${engine.models?.default ? ` · ${engine.models.default}` : ''}`

// 调整成员：只换模型或运行时；成员 id、证据、交接和历史都不动。
export function BodySwapDialog({ member, engines = [], features = null, requiresGate = false, canRemove = false, busy = false, error = null, onCancel, onConfirm, onRemove = null, onRefresh = null }) {
  const readiness = engineReadiness(engines, { requireApproval: requiresGate })
  const available = readiness.installed
  const [tab, setTab] = useState('body')
  const [engineId, setEngineId] = useState(member.body?.engine ?? '')
  const [modelId, setModelId] = useState(member.body?.model ?? '')
  const [confirming, setConfirming] = useState(false)
  const [spec, setSpec] = useState(() => bodySpecOf(member))
  const [customOpen, setCustomOpen] = useState(() => {
    // 工作室成员只有角色默认性格，没有预设可选。
    if (roleLabelOf(member) !== '成员') return false
    const prompt = bodySpecOf(member).prompt.trim()
    return prompt === '' || !MIND_PRESETS.some(item => item.prompt === prompt)
  })
  const { busyId: loginBusyId, note: loginNote, login, clearNote } = useEngineLogin(onRefresh)
  const engine = available.find(item => item.id === engineId)
  const rows = modelRowsFor(engine)
  const model = modelId !== '' ? modelId : (engine?.models?.default ?? rows[0]?.id ?? '')
  const capabilities = bodyCapabilitiesOf({ engine, member, features })
  const blockedReason = engineBlockReason(engine, { requireApproval: requiresGate })
  const blocked = blockedReason !== ''
  const specMissing = member.body?.spec === undefined || member.body?.spec === null
  const specFilled = !specMissing || [spec.prompt, spec.skillsText, spec.mcpText]
    .some(value => String(value ?? '').trim() !== '')
  const originalSpec = bodySpecPayload(bodySpecOf(member))
  const currentSpec = bodySpecPayload(spec)
  const mindChanged = (currentSpec.prompt ?? '') !== (originalSpec.prompt ?? '')
  const capabilityChanged = JSON.stringify({ skills: currentSpec.skills, mcp: currentSpec.mcp })
    !== JSON.stringify({ skills: originalSpec.skills, mcp: originalSpec.mcp })
  const unchanged = engineId === (member.body?.engine ?? '')
    && model === (member.body?.model ?? '')
    && !mindChanged
    && !capabilityChanged
  const roleBound = roleLabelOf(member) !== '成员'
  // 角色成员的提示词不是用户写的人格，而是角色定义；只读展示，保存时仍交给角色默认。
  const rolePrompt = roleBound
    ? (bodySpecOf(member).prompt.trim() || roleDefinitionOf(member.role)?.prompt || '')
    : ''
  const overlay = useOverlay({ label: '调整成员', onClose: busy ? () => {} : onCancel, active: true })
  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-body-swap',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '调整成员',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, member.name)),
    h(Segmented, {
      label: '换身体或换性格',
      value: tab,
      onChange: setTab,
      disabled: busy,
      className: 'crew-dialog-seg',
      options: [
        { value: 'body', label: '身体' },
        { value: 'mind', label: '性格' },
      ],
    }),
    h('div', { className: 'crew-dialog-body' },
      tab === 'body' ? h(Fragment, null,
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, '智能体'),
        h('select', {
          className: 'crew-member-menu',
          'aria-label': `${member.name}的智能体`,
          value: engineId,
          disabled: busy,
          onChange: event => {
            setEngineId(event.target.value)
            setModelId('')
            clearNote()
          },
        },
        h('option', { value: '' }, '选一个智能体'),
        available.map(item => {
          const reason = engineBlockReason(item, { requireApproval: requiresGate })
          return h('option', {
            key: item.id,
            value: item.id,
            disabled: reason !== '',
          }, `${labelOf(item)}${reason === '' ? '' : ` · ${engineBlockLabel(reason)}`}`)
        }))),
      engine !== undefined && rows.length > 0
        ? h('label', { className: 'crew-field crew-body-swap-field' },
          h('b', null, '模型'),
          h('select', {
            className: 'crew-member-menu',
            'aria-label': `${member.name}的模型`,
            value: model,
            disabled: busy,
            onChange: event => setModelId(event.target.value),
          },
          rows.map(item => h('option', { key: item.id, value: item.id }, item.label))))
        : null,
      specMissing && !specFilled && tab === 'body'
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '先补上行为说明、技能或 MCP。')
        : null,
      available.length === 0
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '先安装或登录一个智能体。')
        : engine !== undefined && blocked && blockedReason !== '登录失效'
          ? blockedReason === '不会先问你外部动作'
            ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个智能体不会先问你，不能执行。换一个会先问你的。')
            : blockedReason === '没有配置模型'
              ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个智能体还没有可用模型。')
              : null
          : null,
      h(EngineLogin, {
        readiness,
        busyId: loginBusyId,
        note: loginNote,
        disabled: busy,
        onLogin: login,
        onRefresh,
      }),
      capabilities.tools
        ? h(CapabilityFields, {
          value: spec,
          onChange: value => setSpec(value),
          disabled: busy,
          showSkills: capabilities.skills,
        })
        : null) : h(Fragment, null,
        roleBound
          ? h('div', { className: 'crew-mind-presets', role: 'group', 'aria-label': '性格' },
            h('button', {
              type: 'button',
              className: 'crew-mind-preset',
              disabled: true,
              'data-active': true,
            }, '默认'))
          : h('div', { className: 'crew-mind-presets', role: 'group', 'aria-label': '换一种性格' },
          MIND_PRESETS.map(item => h('button', {
            key: item.id,
            type: 'button',
            className: 'crew-mind-preset',
            disabled: busy,
            'data-active': (!customOpen && spec.prompt === item.prompt) || undefined,
            onClick: () => {
              setSpec({ ...spec, prompt: item.prompt })
              setCustomOpen(false)
            },
          }, item.label)),
          h('button', {
            type: 'button',
            className: 'crew-mind-preset',
            disabled: busy,
            'data-active': customOpen || undefined,
            onClick: () => {
              // 自定义从空白开始，不把上一个预设的话抄进来。
              setSpec(current => (
                MIND_PRESETS.some(item => item.prompt === current.prompt)
                  ? { ...current, prompt: '' }
                  : current
              ))
              setCustomOpen(true)
            },
          }, '自定义')),
        h('textarea', {
          className: 'crew-mind-raw',
          rows: 4,
          'aria-label': '性格',
          placeholder: '留空就用角色默认。',
          value: roleBound ? rolePrompt : (spec.prompt ?? ''),
          readOnly: roleBound || !customOpen,
          disabled: busy,
          'data-readonly': roleBound || !customOpen || undefined,
          onChange: event => {
            if (roleBound) return
            setSpec({ ...spec, prompt: event.target.value })
          },
        })),
      confirming
        ? h('p', { className: 'crew-dialog-note', role: 'alert' }, `移出后，${member.name}不再在这间房。聊天记录还在。`)
        : null,
      error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
    h('div', { className: 'crew-dialog-foot' },
      canRemove && onRemove !== null && !confirming
        ? h('button', {
          type: 'button',
          className: 'crew-ghost crew-body-swap-remove',
          disabled: busy,
          onClick: () => setConfirming(true),
        }, '移出房间')
        : null,
      confirming
        ? h(Fragment, null,
          h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: () => setConfirming(false) }, '取消'),
          h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            'data-danger': 'true',
            disabled: busy,
            onClick: () => onRemove(),
          }, busy ? '正在移除…' : '移除'))
        : h(Fragment, null,
      h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: onCancel }, '取消'),
      h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy || blocked || unchanged || engineId === '' || model === '' || !specFilled,
        onClick: () => onConfirm({ engine: engineId, model, ...bodySpecPayload(spec) }),
      }, busy ? '正在保存…' : '完成')))))
}
