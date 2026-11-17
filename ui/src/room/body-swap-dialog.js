import { Fragment, createElement as h, useState } from 'react'
import { EngineLogin, useEngineLogin } from '../engine-login.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'
import { useOverlay } from '../overlay.js'
import { modelRowsFor, roleLabelOf } from './member-options.js'
import { BodySpecFields, CapabilityFields, bodySpecOf, bodySpecPayload } from './body-spec-fields.js'

const MIND_PRESETS = [
  { id: 'rigorous', label: '严谨', prompt: '先核对事实与证据，指出不确定的地方；不轻易下结论。', sample: '我先核对证据，再给结论；没把握的地方我会直说。' },
  { id: 'decisive', label: '果断', prompt: '先给判断和推荐答案，再补理由；不绕弯。', sample: '我的判断是这样，理由有三点；先按这个走。' },
  { id: 'gentle', label: '温和', prompt: '先理解对方，再提出不同意见；语气克制，不压人。', sample: '我理解你的顾虑；我这边有个不同看法，可以一起看看。' },
  { id: 'critical', label: '挑刺', prompt: '主动找反例、漏洞和风险；宁可多问一句，不放过疑点。', sample: '这里可能有个漏洞：如果前提不成立，结论就站不住。' },
]

const labelOf = engine => `${engine.name ?? engine.id}${engine.models?.default ? ` · ${engine.models.default}` : ''}`

const permissionOf = member => (
  member.permissions?.write === true
    ? '可写工作副本'
    : member.permissions?.exec === true ? '可跑检查' : '只读'
)

// 调整成员：只换模型或运行时；成员 id、证据、交接和历史都不动。
export function BodySwapDialog({ member, engines = [], requiresGate = false, canRemove = false, busy = false, error = null, onCancel, onConfirm, onRemove = null, onRefresh = null }) {
  const readiness = engineReadiness(engines, { requireApproval: requiresGate })
  const available = readiness.installed
  const [tab, setTab] = useState('body')
  const [engineId, setEngineId] = useState(member.body?.engine ?? '')
  const [modelId, setModelId] = useState(member.body?.model ?? '')
  const [confirming, setConfirming] = useState(false)
  const [spec, setSpec] = useState(() => bodySpecOf(member))
  const { busyId: loginBusyId, note: loginNote, login, clearNote } = useEngineLogin(onRefresh)
  const engine = available.find(item => item.id === engineId)
  const rows = modelRowsFor(engine)
  const model = modelId !== '' ? modelId : (engine?.models?.default ?? rows[0]?.id ?? '')
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
  const [mindConfirmed, setMindConfirmed] = useState(false)
  const unchanged = engineId === (member.body?.engine ?? '')
    && model === (member.body?.model ?? '')
    && !mindChanged
    && !capabilityChanged
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
      h('h2', null, `调整 ${member.name}`),
      h('p', null, '身体和想法分开换；成员、记录都留在房间里。'),
      h('p', { className: 'crew-body-swap-identity' },
        [roleLabelOf(member), permissionOf(member), member.approval === 'ask' ? '外部操作先问你' : ''].filter(Boolean).join(' · '))),
    h('div', { className: 'crew-dialog-tabs', role: 'tablist', 'aria-label': '换身体或换想法' },
      h('button', {
        type: 'button',
        role: 'tab',
        className: 'crew-dialog-tab',
        'aria-selected': tab === 'body',
        'data-active': tab === 'body' || undefined,
        onClick: () => setTab('body'),
      }, '换身体'),
      h('button', {
        type: 'button',
        role: 'tab',
        className: 'crew-dialog-tab',
        'aria-selected': tab === 'mind',
        'data-active': tab === 'mind' || undefined,
        onClick: () => setTab('mind'),
      }, '换想法')),
    h('div', { className: 'crew-dialog-body' },
      tab === 'body' ? h(Fragment, null,
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, '模型服务'),
        h('select', {
          className: 'crew-member-menu',
          'aria-label': `${member.name}的模型服务`,
          value: engineId,
          disabled: busy,
          onChange: event => {
            setEngineId(event.target.value)
            setModelId('')
            clearNote()
          },
        },
        h('option', { value: '' }, '选一个模型服务'),
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
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '先安装或登录一个模型服务。')
        : blocked && blockedReason !== '登录失效'
          ? h('p', { className: 'crew-field-hint', role: 'alert' }, blockedReason === '不会先问你外部动作'
            ? '这个模型不会先问你，不能执行。换一个会先问你的。'
            : blockedReason === '没有配置模型'
              ? '这个模型服务还没有模型。'
              : '换一个可用的模型服务。')
          : null,
      h(EngineLogin, {
        readiness,
        busyId: loginBusyId,
        note: loginNote,
        disabled: busy,
        onLogin: login,
        onRefresh,
      })) : h(Fragment, null,
        h('p', { className: 'crew-field-hint', role: 'note' }, '换想法会改变它的判断方式；名字、记录和房间位置不变。'),
        h('div', { className: 'crew-mind-presets', role: 'group', 'aria-label': '换一种想法' },
          MIND_PRESETS.map(item => h('button', {
            key: item.id,
            type: 'button',
            className: 'crew-mind-preset',
            disabled: busy,
            'data-active': spec.prompt === item.prompt || undefined,
            onClick: () => {
              setSpec({ ...spec, prompt: item.prompt })
              setMindConfirmed(false)
            },
          }, item.label))),
        h('p', { className: 'crew-mind-preview' }, `换完之后，它会这样说话：${(MIND_PRESETS.find(item => item.prompt === spec.prompt) ?? { sample: '它会按你写的说明来判断。' }).sample}`),
        h('details', { className: 'crew-body-spec', open: MIND_PRESETS.some(item => item.prompt === spec.prompt) ? undefined : true },
          h('summary', null, '高级：自己写行为说明'),
          h('textarea', {
            className: 'crew-goal-input',
            rows: 3,
            'aria-label': '行为说明',
            placeholder: '写给这位成员的长期说明；留空就用角色默认。',
            value: spec.prompt ?? '',
            disabled: busy,
            onChange: event => {
              setSpec({ ...spec, prompt: event.target.value })
              setMindConfirmed(false)
            },
          })),
        h('p', { className: 'crew-field-hint' }, '能力（不会改变性格）'),
        h(CapabilityFields, {
          value: spec,
          onChange: value => setSpec(value),
          disabled: busy,
        })),
      confirming
        ? h('p', { className: 'crew-dialog-note', role: 'alert' }, `移出后，${member.name}的工作位会撤掉。聊天记录还在。`)
        : null,
      error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
    h('div', { className: 'crew-dialog-foot' },
      canRemove && onRemove !== null && !confirming
        ? h('button', {
          type: 'button',
          className: 'crew-ghost crew-body-swap-remove',
          disabled: busy,
          onClick: () => setConfirming(true),
        }, '移除成员')
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
        onClick: () => {
          if (mindChanged && !mindConfirmed) {
            setMindConfirmed(true)
            return
          }
          onConfirm({ engine: engineId, model, ...bodySpecPayload(spec) })
        },
      }, busy ? '正在保存…' : mindChanged && !mindConfirmed ? '确认换想法' : '保存')))))
}
