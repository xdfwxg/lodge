import { Fragment, createElement as h, useState } from 'react'
import { EngineLogin, useEngineLogin } from '../engine-login.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'
import { useOverlay } from '../overlay.js'

const engineLabelOf = engine => engine.name ?? engine.id

// 成员只换执行者：成员 id、证据、交接、历史、性格和工具面都不动；模型用执行者的默认配置。
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
  const currentEngine = member.body?.engine ?? ''
  const [engineId, setEngineId] = useState(currentEngine)
  const [confirming, setConfirming] = useState(false)
  const { busyId: loginBusyId, note: loginNote, login, clearNote } = useEngineLogin(onRefresh)
  const engine = available.find(item => item.id === engineId)
  // 只换执行者：留在同一个执行者就保留它现在的模型；换到别家才用那家的默认模型。
  const model = engineId === currentEngine
    ? (member.body?.model ?? engine?.models?.default ?? '')
    : (engine?.models?.default ?? '')
  const blockedReason = engineBlockReason(engine, { requireApproval: requiresGate })
  const blocked = blockedReason !== ''
  const unchanged = engineId === currentEngine
  const title = member.name
  const subject = member.name
  const overlay = useOverlay({ label: title, onClose: busy ? () => {} : onCancel, active: true })

  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-body-swap',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-body' },
      h('label', { className: 'crew-field crew-body-swap-field' },
        h('b', null, subject),
        h('select', {
          className: 'crew-member-menu',
          'aria-label': `${member.name}的机器人`,
          value: engineId,
          disabled: busy,
          onChange: event => {
            setEngineId(event.target.value)
            clearNote()
          },
        },
        engineId === '' ? h('option', { value: '' }, '选一个') : null,
        available.map(item => {
          const reason = engineBlockReason(item, { requireApproval: requiresGate })
          return h('option', {
            key: item.id,
            value: item.id,
            disabled: reason !== '',
          }, `${engineLabelOf(item)}${reason === '' ? '' : ` · ${engineBlockLabel(reason)}`}`)
        }),
        engineId !== '' && !available.some(item => item.id === engineId)
          ? h('option', { value: engineId, disabled: true }, `${engineId} · 现在不可用`)
          : null)),
      available.length === 0
        ? h('p', { className: 'crew-field-hint', role: 'alert' }, '先安装或登录一个模型服务。')
        : engine !== undefined && blocked && blockedReason !== '登录失效'
          ? blockedReason === '不会先问你外部动作'
            ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个选项不会先问你，不能执行。换一个会先问你的。')
            : blockedReason === '没有配置模型'
              ? h('p', { className: 'crew-field-hint', role: 'alert' }, '这个选项还没有可用模型。')
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
        : h('button', {
          type: 'button',
          className: 'crew-accept crew-dialog-primary',
          disabled: busy || unchanged || blocked || engineId === '' || model === '',
          onClick: () => onConfirm({ engine: engineId, model }),
        }, busy ? '正在保存…' : '完成')))
  )
}
