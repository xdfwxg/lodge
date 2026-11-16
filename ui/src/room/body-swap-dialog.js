import { Fragment, createElement as h, useState } from 'react'
import { EngineLogin, useEngineLogin } from '../engine-login.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'
import { useOverlay } from '../overlay.js'
import { modelRowsFor } from './member-options.js'
import { BodySpecFields, bodySpecOf, bodySpecPayload } from './body-spec-fields.js'

const labelOf = engine => `${engine.name ?? engine.id}${engine.models?.default ? ` · ${engine.models.default}` : ''}`

const roleLabelOf = member => ({
  lead: '规划师',
  planner: '规划师',
  worker: '执行官',
  executor: '执行官',
  verifier: '验收员',
  participant: '成员',
}[member.roleKind ?? member.role] ?? '成员')

const permissionOf = member => (
  member.permissions?.write === true
    ? '可写工作副本'
    : member.permissions?.exec === true ? '可跑检查' : '只读'
)

// 换身体：只换模型或运行时；成员 id、证据、交接和历史都不动。
export function BodySwapDialog({ member, engines = [], requiresGate = false, canRemove = false, busy = false, error = null, onCancel, onConfirm, onRemove = null, onRefresh = null }) {
  const readiness = engineReadiness(engines, { requireApproval: requiresGate })
  const available = readiness.installed
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
  const unchanged = engineId === (member.body?.engine ?? '')
    && model === (member.body?.model ?? '')
    && JSON.stringify(bodySpecPayload(spec)) === JSON.stringify(bodySpecPayload(bodySpecOf(member)))
  const overlay = useOverlay({ label: '换身体', onClose: busy ? () => {} : onCancel, active: true })
  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-body-swap',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '换身体',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, `给${member.name}换身体`),
      h('p', null, '只换这具身体的模型和行为；成员、证据和历史都留在房间里。'),
      h('p', { className: 'crew-body-swap-identity' },
        [roleLabelOf(member), permissionOf(member), member.approval === 'ask' ? '外部操作先问你' : ''].filter(Boolean).join(' · '))),
    h('div', { className: 'crew-dialog-body' },
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, '模型服务'),
        h('select', {
          className: 'crew-member-menu',
          'aria-label': '换身体的模型服务',
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
            'aria-label': '换身体的模型',
            value: model,
            disabled: busy,
            onChange: event => setModelId(event.target.value),
          },
          rows.map(item => h('option', { key: item.id, value: item.id }, item.label))))
        : null,
      h(BodySpecFields, { value: spec, onChange: setSpec, disabled: busy }),
      specMissing && !specFilled
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这具身体没有配置记录；先补上行为说明、技能或 MCP，再换身体。')
        : null,
      available.length === 0
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '还没有可用的模型服务；先安装或登录一家，再回来。')
        : blocked && blockedReason !== '登录失效'
          ? h('p', { className: 'crew-field-hint', role: 'alert' }, blockedReason === '不会先问你外部动作'
            ? '这个模型不会先问你，不能用来执行。换一个会先问你的模型。'
            : blockedReason === '没有配置模型'
              ? '这个模型服务没有配置模型；先在服务里配置一个模型。'
              : '这个模型服务现在不可用；选一个可用的。')
          : null,
      h(EngineLogin, {
        readiness,
        busyId: loginBusyId,
        note: loginNote,
        disabled: busy,
        onLogin: login,
        onRefresh,
      }),
      confirming
        ? h('p', { className: 'crew-dialog-note', role: 'alert' }, `把${member.name}移出房间后，身体和工位会撤掉，聊天记录和证据还在。`)
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
        onClick: () => onConfirm({ engine: engineId, model, ...bodySpecPayload(spec) }),
      }, busy ? '正在换…' : '换身体')))))
}
