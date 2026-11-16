import { createElement as h, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { modelRowsFor } from './member-options.js'

const ROLE_LABEL = { executor: '执行官', verifier: '验收员' }

const firstReady = engines => engines.find(item => (
  item.available === true && item.authenticated !== false && item.capabilities?.approvalReview === true
))

// 添加 Bot = 往房间花名册加一条带 body 的成员；不碰全局 Bot 列表。
export function MemberAddDialog({ engines = [], busy = false, error = null, onCancel, onConfirm }) {
  const available = engines.filter(item => item.available)
  const ready = firstReady(available)
  const [role, setRole] = useState('executor')
  const [name, setName] = useState('')
  const [engineId, setEngineId] = useState(ready?.id ?? '')
  const [modelId, setModelId] = useState(ready?.models?.default ?? '')
  const engine = available.find(item => item.id === engineId)
  const rows = modelRowsFor(engine)
  const model = modelId !== '' ? modelId : (engine?.models?.default ?? rows[0]?.id ?? '')
  const unauthenticated = engine !== undefined && engine.authenticated === false
  const noGate = engine !== undefined && engine.capabilities?.approvalReview !== true
  const blocked = unauthenticated || noGate
  const overlay = useOverlay({ label: '添加成员', onClose: busy ? () => {} : onCancel, active: true })
  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-member-add',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '添加成员',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, '给房间添一位成员'),
      h('p', null, '只加执行官或验收员；规划师是这间房唯一的主机器人。')),
    h('div', { className: 'crew-dialog-body' },
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, '角色'),
        h('select', {
          className: 'crew-member-menu',
          'aria-label': '新成员的角色',
          value: role,
          disabled: busy,
          onChange: event => setRole(event.target.value),
        },
        Object.entries(ROLE_LABEL).map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, '名字'),
        h('input', {
          className: 'crew-goal-input',
          type: 'text',
          'aria-label': '新成员的名字',
          placeholder: role === 'verifier' ? '例如：验收员二号' : '例如：执行官二号',
          value: name,
          maxLength: 32,
          disabled: busy,
          onChange: event => setName(event.target.value),
        })),
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, '模型服务'),
        h('select', {
          className: 'crew-member-menu',
          'aria-label': '新成员的模型服务',
          value: engineId,
          disabled: busy,
          onChange: event => {
            setEngineId(event.target.value)
            setModelId('')
          },
        },
        h('option', { value: '' }, '选一个模型服务'),
        available.map(item => {
          const itemUnauthenticated = item.authenticated === false
          const allowed = !itemUnauthenticated && item.capabilities?.approvalReview === true
          return h('option', {
            key: item.id,
            value: item.id,
            disabled: !allowed,
          }, `${item.name ?? item.id}${itemUnauthenticated ? ' · 未登录' : allowed ? '' : ' · 不能执行'}`)
        }))),
      engine !== undefined && rows.length > 0
        ? h('label', { className: 'crew-field crew-body-swap-field' },
          h('b', null, '模型'),
          h('select', {
            className: 'crew-member-menu',
            'aria-label': '新成员的模型',
            value: model,
            disabled: busy,
            onChange: event => setModelId(event.target.value),
          },
          rows.map(item => h('option', { key: item.id, value: item.id }, item.label))))
        : null,
      unauthenticated
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个模型服务没有登录，先登录再加。')
        : noGate
          ? h('p', { className: 'crew-field-hint', role: 'alert' }, '执行成员要用会先问你外部动作的模型。')
          : h('p', { className: 'crew-field-hint' }, '权限由角色决定；新成员会成为房间里的正式成员，可以接 Assignment。'),
      error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
    h('div', { className: 'crew-dialog-foot' },
      h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: onCancel }, '取消'),
      h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy || blocked || name.trim() === '' || engineId === '' || model === '',
        onClick: () => onConfirm({ role, name: name.trim(), engine: engineId, model }),
      }, busy ? '正在添加…' : '添加'))))
}
