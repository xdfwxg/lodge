import { Fragment, createElement as h, useEffect, useState } from 'react'
import { EngineLogin, useEngineLogin } from '../engine-login.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'
import { useOverlay } from '../overlay.js'
import { modelRowsFor } from './member-options.js'
import { CapabilityFields, bodySpecOf, bodySpecPayload } from './body-spec-fields.js'
import { Segmented } from '../segmented.js'

const ROLE_LABEL = { executor: '执行官', verifier: '验收员' }
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

// 名字跟着角色自动填：已有执行官时，下一个就叫执行官二号。
const autoName = (role, members = []) => {
  const base = ROLE_LABEL[role]
  const count = members.filter(member => (member.roleKind ?? member.role) === role).length
  if (count === 0) return base
  return `${base}${CN[count + 1] ?? count + 1}号`
}

// 添加 Bot = 往房间花名册加一条带 body 的成员；不碰全局 Bot 列表。
export function MemberAddDialog({ engines = [], members = [], busy = false, error = null, onCancel, onConfirm, onRefresh = null }) {
  const readiness = engineReadiness(engines, { requireApproval: true })
  const available = readiness.installed
  const ready = readiness.ready[0]
  const [role, setRole] = useState('executor')
  const [name, setName] = useState(() => autoName('executor', members))
  const [tab, setTab] = useState('body')
  const [engineId, setEngineId] = useState(ready?.id ?? '')
  const [modelId, setModelId] = useState(ready?.models?.default ?? '')
  const [spec, setSpec] = useState(() => bodySpecOf({}))
  const { busyId: loginBusyId, note: loginNote, login, clearNote } = useEngineLogin(onRefresh)
  const engine = available.find(item => item.id === engineId)
  const rows = modelRowsFor(engine)
  const model = modelId !== '' ? modelId : (engine?.models?.default ?? rows[0]?.id ?? '')
  const blockedReason = engineBlockReason(engine, { requireApproval: true })
  const blocked = blockedReason !== ''
  useEffect(() => {
    if (engineId !== '' || ready === undefined) return
    setEngineId(ready.id)
    setModelId(ready.models?.default ?? '')
  }, [engineId, ready?.id])
  const overlay = useOverlay({ label: '添加成员', onClose: busy ? () => {} : onCancel, active: true })
  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-member-add-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '添加成员',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, '加一位成员')),
    h('div', { className: 'crew-add-who' },
      h('div', { className: 'crew-field crew-add-role' },
        h('b', null, '角色'),
        h(Segmented, {
          label: '角色',
          value: role,
          onChange: next => {
            setRole(next)
            setName(autoName(next, members))
          },
          disabled: busy,
          options: [
            { value: 'executor', label: '执行官' },
            { value: 'verifier', label: '验收员' },
          ],
        })),
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
        }))),
    h(Segmented, {
      label: '换身体或性格',
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
          h('b', null, 'Agent'),
          h('select', {
            className: 'crew-member-menu',
            'aria-label': '新成员的 Agent',
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
            const reason = engineBlockReason(item, { requireApproval: true })
            return h('option', {
              key: item.id,
              value: item.id,
              disabled: reason !== '',
            }, `${item.name ?? item.id}${reason === '' ? '' : ` · ${engineBlockLabel(reason)}`}`)
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
        available.length === 0
          ? h('p', { className: 'crew-field-hint', role: 'alert' }, '先安装或登录一个模型服务。')
          : engineId === '' && readiness.ready.length === 0 && readiness.noModels.length > 0 &&
            readiness.loginTargets.length + readiness.manualLogin.length === 0
            ? h('p', { className: 'crew-field-hint', role: 'alert' },
              `${readiness.noModels.map(item => item.name ?? item.id).join('、')}还没有模型。`)
            : engineId === '' || !blocked
              ? null
            : h('p', { className: 'crew-field-hint', role: 'alert' }, blockedReason === '不会先问你外部动作'
              ? '执行成员要用会先问你的模型。'
              : blockedReason === '登录失效'
                ? '这个模型服务还没登录。'
                : blockedReason === '没有配置模型'
                  ? '这个模型服务还没有模型。'
                  : '换一个可用的模型服务。'),
        h(EngineLogin, {
          readiness,
          busyId: loginBusyId,
          note: loginNote,
          disabled: busy,
          onLogin: login,
          onRefresh,
        })) : h(Fragment, null,
        h('textarea', {
          className: 'crew-mind-raw',
          rows: 4,
          'aria-label': '性格',
          placeholder: '留空就按角色默认。',
          value: spec.prompt ?? '',
          disabled: busy,
          onChange: event => setSpec({ ...spec, prompt: event.target.value }),
        }),
        h(CapabilityFields, { value: spec, onChange: setSpec, disabled: busy })),
      error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
    h('div', { className: 'crew-dialog-foot' },
      h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: onCancel }, '取消'),
      h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy || blocked || name.trim() === '' || engineId === '' || model === '',
        onClick: () => onConfirm({ role, name: name.trim(), engine: engineId, model, ...bodySpecPayload(spec) }),
      }, busy ? '正在添加…' : '加入'))))
}
