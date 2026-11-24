import { Fragment, createElement as h, useState } from 'react'
import { EngineLogin, useEngineLogin } from '../engine-login.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'
import { useOverlay } from '../overlay.js'
import { modelRowsFor } from './member-options.js'

const labelOf = engine => `${engine.name ?? engine.id}${engine.models?.default ? ` · ${engine.models.default}` : ''}`

// 成员只换模型：成员 id、证据、交接、历史、性格和工具面都不动。
export function BodySwapDialog({
  member,
  engines = [],
  requiresGate = false,
  canRemove = false,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
  onRemove = null,
  onRefresh = null,
}) {
  const readiness = engineReadiness(engines, { requireApproval: requiresGate })
  const available = readiness.installed
  const [engineId, setEngineId] = useState(member.body?.engine ?? '')
  const [modelId, setModelId] = useState(member.body?.model ?? '')
  const [confirming, setConfirming] = useState(false)
  const { busyId: loginBusyId, note: loginNote, login, clearNote } = useEngineLogin(onRefresh)
  const engine = available.find(item => item.id === engineId)
  const rows = modelRowsFor(engine)
  const model = modelId !== '' ? modelId : (engine?.models?.default ?? rows[0]?.id ?? '')
  const blockedReason = engineBlockReason(engine, { requireApproval: requiresGate })
  const blocked = blockedReason !== ''
  const unchanged = engineId === (member.body?.engine ?? '') && model === (member.body?.model ?? '')
  const title = '换个模型'
  const overlay = useOverlay({ label: title, onClose: busy ? () => {} : onCancel, active: true })

  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-body-swap',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, title),
      h('p', null, `${member.name} · 只换模型，记录和证据不变`)),
    h('div', { className: 'crew-dialog-body' },
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
      available.length === 0
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '先安装或登录一个模型服务。')
        : engine !== undefined && blocked && blockedReason !== '登录失效'
          ? blockedReason === '不会先问你外部动作'
            ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个模型服务不会先问你，不能执行。换一个会先问你的。')
            : blockedReason === '没有配置模型'
              ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个模型服务还没有可用模型。')
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
            disabled: busy || blocked || unchanged || engineId === '' || model === '',
            onClick: () => onConfirm({ engine: engineId, model }),
          }, busy ? '正在保存…' : '换好'))))
  )
}
