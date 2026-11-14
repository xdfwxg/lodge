import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uiKindOfRoom } from '../room/kinds.js'
import { money } from '../view-format.js'
import { initialOf } from '../marks.js'

const GROUPS = [
  { id: 'studio', label: '工作室' },
  { id: 'chat', label: '聊天室' },
]

const railQuery = () => (
  typeof matchMedia === 'function' ? matchMedia('(max-width:760px)').matches : false
)

function Sidebar({ state, onSelect, onNew }) {
  const { rooms, activeId } = state
  const [folded, setFolded] = useState({})
  const [rail, setRail] = useState(railQuery)
  const [open, setOpen] = useState(false)
  const sidebarRef = useRef(null)
  const waiting = rooms.filter(room => room.needsYou).length
  const toggle = id => setFolded(current => ({ ...current, [id]: current[id] !== true }))
  const collapsed = rail && !open
  const expanded = !collapsed

  useEffect(() => {
    const mq = matchMedia('(max-width:760px)')
    const sync = () => setRail(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    if (!rail) setOpen(false)
  }, [rail])

  useLayoutEffect(() => {
    if (!rail) delete document.body.dataset.side
    else document.body.dataset.side = open ? 'open' : 'rail'
    return () => { delete document.body.dataset.side }
  }, [rail, open])

  useEffect(() => {
    if (!open) return undefined
    const main = document.querySelector('.dsb-main')
    main?.setAttribute('inert', '')
    const onKeyDown = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // 看按 ESC 时的目标，而不是 activeElement：上层弹窗可能已同步关闭并把焦点还回侧栏。
      if (sidebarRef.current?.contains(event.target) !== true) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      main?.removeAttribute('inert')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggleSide = () => {
    if (!rail) {
      setRail(true)
      setOpen(false)
      return
    }
    setOpen(value => !value)
  }
  const selectRoom = id => {
    if (open) setOpen(false)
    onSelect(id)
  }

  return h(Fragment, null,
    rail
      ? h('div', {
        className: 'crew-side-scrim',
        onClick: () => setOpen(false),
        'aria-hidden': 'true',
      })
      : null,
    h('aside', { id: 'crew-side', ref: sidebarRef, className: 'dsb-side' },
      h('div', { className: 'crew-side-brand' },
        h('img', { className: 'crew-side-brand-logo', src: './logo.svg', alt: '', width: 22, height: 22 }), 'Lodge'),
      state.runtime?.ok === false
        ? h('div', {
          className: 'crew-error crew-side-error',
          title: `基座未连接：${state.runtime.error}`,
          'aria-label': `基座未连接：${state.runtime.error}`,
        },
        h('span', { className: 'crew-side-error-mark', 'aria-hidden': 'true' }, '!'),
        h('span', { className: 'crew-side-error-text' }, `基座未连接：${state.runtime.error}`))
        : null,
      h('div', { className: 'crew-side-tools' },
        waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个等你`) : h('span'),
        h('button', {
          type: 'button',
          className: 'crew-side-toggle',
          'aria-label': expanded ? '收起侧栏' : '展开侧栏',
          'aria-expanded': expanded,
          'aria-controls': 'crew-side',
          onClick: toggleSide,
        }, expanded ? '«' : '»'),
        h('button', { type: 'button', className: 'crew-new', 'aria-label': '新建房间', onClick: onNew }, '＋ 新建')),
      h('div', { className: 'bt-side' },
        h('div', { className: 'bt-list' },
          GROUPS.map(group => {
            const items = rooms.filter(room => uiKindOfRoom(room).id === group.id)
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
              collapsed || !closed ? items.map(room => h(RoomRow, {
                key: room.id,
                room,
                active: activeId === room.id,
                onSelect: () => selectRoom(room.id),
              })) : null)
          }))),
      state.budget?.globalBudgetMicroUsd > 0
        ? h('div', { className: 'crew-me', title: '全局预算' },
          h('span', { className: 'crew-me-badge' }, '预'),
          h('span', { className: 'crew-me-body' },
            h('b', null, '全局预算'),
            h('small', null, `${money(state.budget.globalSpentMicroUsd)} / ${money(state.budget.globalBudgetMicroUsd)}`)))
        : null,
      h('div', { className: 'crew-me' },
        h('span', { className: 'crew-me-badge' }, '你'),
        h('span', { className: 'crew-me-body' }, h('b', null, '你')))))
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

// 可达名称：名称 + 状态 + 未读 + needsYou 文案，rail 态不依赖颜色也能读出来。
export const roomLabelOf = room => {
  const meta = metaOf(room)
  const parts = [room?.name ?? '房间']
  if (meta !== '') parts.push(meta)
  if (room?.chatUnread === true) parts.push('有新消息')
  if (room?.needsYou?.label && room.needsYou.label !== meta) parts.push(room.needsYou.label)
  return parts.join('，')
}

function RoomRow({ room, active, onSelect }) {
  const label = roomLabelOf(room)
  return h('button', {
    type: 'button',
    className: 'bt-row crew-side-room',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
    title: label,
    'aria-label': label,
  },
  h('span', { className: 'crew-side-room-badge', 'aria-hidden': 'true' }, initialOf(room.name, '·')),
  h('span', { className: 'crew-side-room-name' }, room.name),
  room.chatUnread === true && !active
    ? h('span', { className: 'crew-unread-dot', title: '聊天有新消息' })
    : null,
  metaOf(room) === '' ? null : h('span', { className: 'crew-side-room-meta', 'data-tone': toneOf(room) }, metaOf(room)),
  h('span', { className: 'crew-side-room-dot', 'data-tone': toneOf(room), title: room.needsYou?.label ?? '' }))
}

export { Sidebar }
