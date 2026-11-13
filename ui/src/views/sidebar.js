import { createElement as h, useState } from 'react'
import { money } from '../view-format.js'

const GROUPS = [
  { id: 'studio', label: '工作室' },
  { id: 'chat', label: '聊天室' },
]

function Sidebar({ state, onSelect, onNew }) {
  const { rooms, activeId } = state
  const [folded, setFolded] = useState({})
  const waiting = rooms.filter(room => room.needsYou).length
  const toggle = id => setFolded(current => ({ ...current, [id]: current[id] !== true }))

  return h('aside', { className: 'dsb-side' },
    h('div', { className: 'crew-side-brand' },
      h('img', { className: 'crew-side-brand-logo', src: './logo.svg', alt: '', width: 22, height: 22 }), 'Lodge'),
    state.runtime?.ok === false
      ? h('div', { className: 'crew-error', style: { margin: '0 6px 10px' } }, `基座未连接：${state.runtime.error}`)
      : null,
    h('div', { className: 'crew-side-tools' },
      waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个等你`) : h('span'),
      h('button', { type: 'button', className: 'crew-new', onClick: onNew }, '＋ 新建')),
    h('div', { className: 'bt-side' },
      h('div', { className: 'bt-list' },
        GROUPS.map(group => {
          const items = rooms.filter(room => (room.roomType ?? 'studio') === group.id)
          if (items.length === 0) return null
          const closed = folded[group.id] === true
          return h('section', { key: group.id, className: 'crew-side-group' },
            h('button', {
              type: 'button',
              className: 'crew-side-group-head',
              'aria-expanded': !closed,
              onClick: () => toggle(group.id),
            },
            h('span', { className: 'crew-side-chevron', 'data-open': !closed }, '⌄'),
            h('span', null, group.label),
            h('span', { className: 'crew-side-count' }, String(items.length))),
            closed ? null : items.map(room => h(RoomRow, {
              key: room.id,
              room,
              active: activeId === room.id,
              onSelect: () => onSelect(room.id),
            })))
        }))),
    state.budget?.globalBudgetMicroUsd > 0
      ? h('div', { className: 'crew-me' },
        h('span', { className: 'crew-me-badge' }, '预'),
        h('span', { className: 'crew-me-body' },
          h('b', null, '全局预算'),
          h('small', null, `${money(state.budget.globalSpentMicroUsd)} / ${money(state.budget.globalBudgetMicroUsd)}`)))
      : null,
    h('div', { className: 'crew-me' },
      h('span', { className: 'crew-me-badge' }, '你'),
      h('span', { className: 'crew-me-body' }, h('b', null, '你'))))
}

const toneOf = room => {
  if (room.needsYou?.kind === 'review') return 'review'
  if (room.needsYou?.kind === 'signoff') return 'done'
  if (room.needsYou?.kind === 'rework' || room.needsYou?.kind === 'budget' || room.needsYou?.kind === 'merge' || room.needsYou?.kind === 'parallel') return 'alert'
  if (room.needsYou) return 'waiting'
  if (room.state === 'complete') return 'done'
  return room.live === true ? 'active' : 'idle'
}

const metaOf = room => {
  if (room.needsYou?.kind === 'signoff') return '签字'
  if (room.needsYou?.kind === 'review') return '复核'
  if (room.needsYou?.kind === 'decision') return '确认'
  if (room.needsYou?.kind === 'rework') return '返工'
  if (room.needsYou) return '等你'
  return room.state === 'complete' ? '完成' : room.live === true ? '实时' : ''
}

function RoomRow({ room, active, onSelect }) {
  return h('button', {
    type: 'button',
    className: 'bt-row crew-side-room',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
    title: room.needsYou?.label ?? room.name,
  },
  h('span', { className: 'crew-side-room-glyph', 'data-type': room.roomType ?? 'studio' }, room.roomType === 'chat' ? '#' : '⎇'),
  h('span', { className: 'crew-side-room-name' }, room.name),
  room.chatUnread === true && !active
    ? h('span', { className: 'crew-unread-dot', title: '聊天有新消息' })
    : null,
  metaOf(room) === '' ? null : h('span', { className: 'crew-side-room-meta', 'data-tone': toneOf(room) }, metaOf(room)),
  h('span', { className: 'crew-side-room-dot', 'data-tone': toneOf(room), title: room.needsYou?.label ?? '' }))
}

export { Sidebar }
