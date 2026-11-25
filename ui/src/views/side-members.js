import { createElement as h, useState } from 'react'
import { bodyStatuses } from '../room/body-status.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { engineBlockLabel, engineBlockReason, engineReadiness } from '../../../shared/engine-readiness.js'

const IDLE = 'idle'

// 房间菜单里的成员面板：每位成员就地选机器人、拨静音，改完按一次完成一起保存。
export function SideMembers({ room, engines = [], onHold = null, onSwapBody = null }) {
  const members = Array.isArray(room?.members) ? room.members : []
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  if (members.length === 0) return null
  const kind = uiKindOfRoom(room)
  const statuses = bodyStatuses(room, members, { labels: kind.memberLabels })
  // 工作室叫“别派活”，聊天室叫“静音”；都只改这个成员在这一轮的状态。
  const canHold = (kind.id === 'studio' || kind.id === 'chat') &&
    room.state === 'active' && room.live === true && typeof onHold === 'function'
  const held = new Set(Array.isArray(room.heldMembers) ? room.heldMembers : [])
  const holdLabel = kind.id === 'chat' ? '静音' : '先别派活'
  const available = engineReadiness(engines, { requireApproval: false }).installed
  const engineOf = item => drafts[item.memberId] ?? item.engine
  const modelOf = (item, engineId) => engineId === item.engine
    ? (item.model || available.find(engine => engine.id === engineId)?.models?.default || '')
    : (available.find(engine => engine.id === engineId)?.models?.default ?? '')
  const changed = statuses.filter(item => engineOf(item) !== item.engine)
  // 只要有一处改成了跑不起来的选项，就在保存前拦住，不把半截改动送出去。
  const readyToSave = typeof onSwapBody === 'function' && changed.length > 0 && !saving &&
    changed.every(item => {
      const engine = available.find(entry => entry.id === engineOf(item))
      return engine !== undefined &&
        engineBlockReason(engine, { requireApproval: false }) === '' &&
        modelOf(item, engineOf(item)) !== ''
    })
  const choose = (item, engineId) => {
    setDrafts(current => ({ ...current, [item.memberId]: engineId }))
    setErrors(current => ({ ...current, [item.memberId]: null }))
  }
  const saveAll = async () => {
    if (!readyToSave) return
    setSaving(true)
    const failed = {}
    for (const item of changed) {
      const result = await onSwapBody(room.id, item.memberId, engineOf(item), modelOf(item, engineOf(item)))
      if (result?.ok !== true) {
        failed[item.memberId] = result?.error ?? '没能保存'
        continue
      }
      setDrafts(current => {
        const next = { ...current }
        delete next[item.memberId]
        return next
      })
    }
    setErrors(failed)
    setSaving(false)
  }

  const memberRow = item => {
    const engineId = engineOf(item)
    const engine = available.find(entry => entry.id === engineId)
    return h('div', {
      key: item.memberId,
      className: 'crew-side-member-edit',
      role: 'group',
      'aria-label': item.name,
    },
    item.state === IDLE ? null : h('span', { className: 'crew-side-member-dot', 'data-tone': item.tone, 'aria-hidden': true }),
    h('span', { className: 'crew-side-member-name' }, item.name),
    item.state === IDLE ? null : h('span', { className: 'crew-side-member-state', 'data-tone': item.tone }, item.label),
    h('select', {
      className: 'crew-member-menu',
      'aria-label': `${item.name}的机器人`,
      value: engineId,
      disabled: saving,
      onChange: event => choose(item, event.target.value),
    },
    engineId === '' ? h('option', { value: '' }, '选一个') : null,
    available.map(entry => {
      const reason = engineBlockReason(entry, { requireApproval: false })
      return h('option', {
        key: entry.id,
        value: entry.id,
        disabled: reason !== '',
      }, `${entry.name ?? entry.id}${reason === '' ? '' : ` · ${engineBlockLabel(reason)}`}`)
    }),
    engineId !== '' && engine === undefined
      ? h('option', { value: engineId, disabled: true }, `${item.engine} · 现在不可用`)
      : null),
    canHold
      ? h('button', {
        type: 'button',
        role: 'switch',
        className: 'crew-side-member-mute',
        'aria-checked': held.has(item.memberId) ? 'true' : 'false',
        'aria-label': `${holdLabel}${item.name}`,
        title: held.has(item.memberId) ? `${holdLabel}中，点一下恢复` : holdLabel,
        onClick: () => onHold(item.memberId, !held.has(item.memberId)),
      })
      : null,
    errors[item.memberId] === null || errors[item.memberId] === undefined
      ? null
      : h('p', { className: 'crew-side-member-edit-note', role: 'alert' }, errors[item.memberId]))
  }

  return h('div', { className: 'crew-side-members', role: 'group', 'aria-label': '房间成员' },
    h('span', { className: 'crew-side-members-label' }, '成员'),
    statuses.map(memberRow),
    h('button', {
      type: 'button',
      className: 'crew-accept crew-side-member-edit-done',
      disabled: !readyToSave,
      onClick: () => void saveAll(),
    }, saving ? '正在保存…' : '完成'))
}
