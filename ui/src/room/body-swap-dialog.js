import { createElement as h, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { modelRowsFor } from './member-options.js'

const labelOf = engine => `${engine.name ?? engine.id}${engine.models?.default ? ` · ${engine.models.default}` : ''}`

// 换身体：只换模型或运行时；成员 id、证据、交接和历史都不动。
export function BodySwapDialog({ member, engines = [], requiresGate = false, busy = false, error = null, onCancel, onConfirm }) {
  const available = engines.filter(item => item.available)
  const [engineId, setEngineId] = useState(member.body?.engine ?? '')
  const [modelId, setModelId] = useState(member.body?.model ?? '')
  const engine = available.find(item => item.id === engineId)
  const rows = modelRowsFor(engine)
  const model = modelId !== '' ? modelId : (engine?.models?.default ?? rows[0]?.id ?? '')
  const blocked = requiresGate === true && engine !== undefined && engine.capabilities?.approvalReview !== true
  const unchanged = engineId === (member.body?.engine ?? '') && model === (member.body?.model ?? '')
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
      h('p', null, '只换模型或运行时；成员、证据、交接和历史都留在房间里。')),
    h('div', { className: 'crew-dialog-body' },
      h('p', { className: 'crew-field-hint' },
        `现在：${member.body?.engine ?? '未知'}${member.body?.model ? ` · ${member.body.model}` : ''}`),
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
          },
        },
        h('option', { value: '' }, '选一个模型服务'),
        available.map(item => {
          const allowed = requiresGate !== true || item.capabilities?.approvalReview === true
          return h('option', {
            key: item.id,
            value: item.id,
            disabled: !allowed,
          }, `${labelOf(item)}${allowed ? '' : ' · 不能执行'}`)
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
      blocked
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个模型不会先问你，不能用来执行。换一个会先问你的模型。')
        : null,
      error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
    h('div', { className: 'crew-dialog-foot' },
      h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: onCancel }, '取消'),
      h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy || blocked || unchanged || engineId === '' || model === '',
        onClick: () => onConfirm(engineId, model),
      }, busy ? '正在换…' : '换身体'))))
}
