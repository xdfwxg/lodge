import { createElement as h, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { uiKindOfRoom } from './kinds.js'

const roleKindOf = member => member.roleKind ?? member.role
const hasRole = (members, kind) => members.some(member => roleKindOf(member) === kind)
const memberSelect = ({ label, value, members, busy, exclude = '', onChange }) => h('label', { className: 'crew-field crew-body-swap-field' },
  h('b', null, label),
  h('select', {
    className: 'crew-member-menu',
    'aria-label': label,
    value,
    disabled: busy,
    onChange: event => onChange(event.target.value),
  }, members
    .filter(member => member.id !== exclude)
    .map(member => h('option', { key: member.id, value: member.id }, member.name ?? member.id))))

export function RoomModeSwitch({ room, onSwitch }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [plannerId, setPlannerId] = useState('')
  const [verifierId, setVerifierId] = useState('')
  const members = room.members ?? []
  const target = uiKindOfRoom(room).id === 'chat' ? 'studio' : 'chat'
  const label = target === 'studio' ? '切换到工作室' : '切换到聊天室'
  const needsPlanner = target === 'studio' && !hasRole(members, 'planner')
  const needsVerifier = target === 'studio' && !hasRole(members, 'verifier')
  const overlay = useOverlay({
    label,
    onClose: busy ? () => {} : () => { setOpen(false); setError(null) },
    active: open,
  })
  if (room.demo === true || room.state === 'stopped' || room.archivedAt) return null
  const openDialog = () => {
    const planner = needsPlanner ? (members[0]?.id ?? '') : ''
    const verifier = needsVerifier ? (members.find(member => member.id !== planner)?.id ?? '') : ''
    setPlannerId(planner)
    setVerifierId(verifier)
    setError(null)
    setOpen(true)
  }
  const confirm = async () => {
    if (needsPlanner && plannerId === '') {
      setError('先选一位成员做规划师')
      return
    }
    if (needsVerifier && verifierId === '') {
      setError('先选一位成员做验收员')
      return
    }
    if (needsPlanner || needsVerifier) {
      if (plannerId === verifierId) {
        setError('规划师和验收员不能是同一位')
        return
      }
    }
    setBusy(true)
    setError(null)
    const result = await onSwitch(target, needsPlanner || needsVerifier ? { plannerId, verifierId } : {})
    setBusy(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '没能切换房型')
      return
    }
    setOpen(false)
  }
  return h('div', { className: 'crew-room-mode-switch' },
    h('button', {
      type: 'button',
      className: 'crew-link',
      'data-menu-keep': '',
      onClick: openDialog,
    }, label),
    open
      ? h('div', { className: 'crew-overlay', onClick: busy ? undefined : () => { setOpen(false); setError(null) }, ...overlay },
        h('div', {
          className: 'crew-dialog crew-mode-switch-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': label,
          onClick: event => event.stopPropagation(),
        },
        h('div', { className: 'crew-dialog-heading' },
          h('h2', null, label),
          h('p', null, '成员和聊天记录都会保留；只切换房间的工作方式。')),
        h('div', { className: 'crew-dialog-body' },
          needsPlanner
            ? memberSelect({ label: '规划师', value: plannerId, members, busy, onChange: setPlannerId })
            : null,
          needsVerifier
            ? memberSelect({ label: '验收员', value: verifierId, members, busy, exclude: needsPlanner ? plannerId : '', onChange: setVerifierId })
            : null,
          h('p', { className: 'crew-dialog-note' }, target === 'studio'
            ? (needsPlanner || needsVerifier
              ? '工作室需要规划师和验收员；在这里指定，现有成员都会保留。'
              : '执行成员会在各自的工作副本里改文件，验收员只写结论。')
            : '聊天室会重新开始一轮讨论，工作室的阶段和交付记录保留。'),
          error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
        h('div', { className: 'crew-dialog-foot' },
          h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: () => { setOpen(false); setError(null) } }, '取消'),
          h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            disabled: busy,
            onClick: confirm,
          }, busy ? '正在切换…' : label))))
      : null)
}
