import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ROOM_TYPE_MANIFEST } from '../../../shared/room-types.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { initialOf } from '../marks.js'

const GROUPS = ROOM_TYPE_MANIFEST.map(({ id, name }) => ({ id, label: name }))

const railQuery = () => (
  typeof matchMedia === 'function' ? matchMedia('(max-width:760px)').matches : false
)

function Sidebar({ state, onSelect, onNew }) {
  const { rooms, activeId } = state
  const [folded, setFolded] = useState({})
  const [rail, setRail] = useState(railQuery)
  const [open, setOpen] = useState(false)
  const [manualCollapsed, setManualCollapsed] = useState(false)
  const sidebarRef = useRef(null)
  const waiting = rooms.filter(room => room.needsYou).length
  const toggle = id => setFolded(current => ({ ...current, [id]: current[id] !== true }))
  const collapsed = rail ? !open : manualCollapsed
  const expanded = !collapsed
  const overlayOpen = rail && open

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

  useEffect(() => {
    let stored = ''
    try { stored = localStorage.getItem('lodge:side-width') ?? '' } catch {}
    const width = Number.parseFloat(stored)
    if (Number.isFinite(width)) document.body.style.setProperty('--crew-side-w', `${clampSide(width)}px`)
    return () => { document.body.style.removeProperty('--crew-side-w') }
  }, [])

  useLayoutEffect(() => {
    if (rail) document.body.dataset.side = open ? 'open' : 'rail'
    else if (manualCollapsed) document.body.dataset.side = 'rail'
    else delete document.body.dataset.side
    return () => { delete document.body.dataset.side }
  }, [rail, open, manualCollapsed])

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
    if (rail) setOpen(value => !value)
    else setManualCollapsed(value => !value)
  }

  // 拖右侧竖线改宽度；宽度存在 localStorage，重启后保留。
  const SIDE_MIN = 200
  const SIDE_MAX = 480
  const clampSide = value => Math.min(SIDE_MAX, Math.max(SIDE_MIN, value))
  const setSideWidth = width => {
    document.body.style.setProperty('--crew-side-w', `${clampSide(Math.round(width))}px`)
    try { localStorage.setItem('lodge:side-width', `${clampSide(Math.round(width))}px`) } catch {}
  }
  const startResize = event => {
    if (event.button !== 0 || sidebarRef.current === null) return
    event.preventDefault()
    const left = sidebarRef.current.getBoundingClientRect().left
    const move = moveEvent => setSideWidth(moveEvent.clientX - left)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }
  const resizeWithKeyboard = event => {
    const current = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--crew-side-w')) || 248
    const next = event.key === 'ArrowLeft' ? current - 16
      : event.key === 'ArrowRight' ? current + 16
        : event.key === 'Home' ? SIDE_MIN
          : event.key === 'End' ? SIDE_MAX
            : null
    if (next === null) return
    event.preventDefault()
    setSideWidth(next)
  }
  const selectRoom = id => {
    if (open) setOpen(false)
    onSelect(id)
  }

  return h(Fragment, null,
    overlayOpen
      ? h('div', {
        className: 'crew-side-scrim',
        onClick: () => setOpen(false),
        'aria-hidden': 'true',
      })
      : null,
    h('aside', { id: 'crew-side', ref: sidebarRef, className: 'dsb-side' },
      rail || manualCollapsed
        ? null
        : h('div', {
          className: 'crew-side-resizer',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': '调整侧栏宽度',
          tabIndex: 0,
          onPointerDown: startResize,
          onKeyDown: resizeWithKeyboard,
        }),
      h('div', { className: 'crew-side-brand' },
        h('img', { className: 'crew-side-brand-logo', src: './logo.svg', alt: '', width: 22, height: 22 }), 'Lodge'),
      state.runtime?.ok === false
        ? h('div', {
          className: 'crew-error crew-side-error',
          role: 'alert',
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
      h('div', { className: 'crew-me' },
        h('span', { className: 'crew-me-badge' }, '你'),
        h('span', { className: 'crew-me-body' }, h('b', null, '你')))))
}

const toneOf = room => {
  if (room.needsYou?.kind === 'review') return 'review'
  if (room.needsYou?.kind === 'signoff') return 'done'
  if (room.needsYou?.kind === 'rework' || room.needsYou?.kind === 'merge' || room.needsYou?.kind === 'parallel') return 'alert'
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
    ? h('span', { className: 'crew-unread-dot', title: '聊天有新消息' }, h('span', { className: 'visually-hidden' }, '聊天有新消息'))
    : null,
  metaOf(room) === '' ? null : h('span', { className: 'crew-side-room-meta', 'data-tone': toneOf(room) }, metaOf(room)),
  h('span', { className: 'crew-side-room-dot', 'data-tone': toneOf(room), title: room.needsYou?.label ?? '' }))
}

export { Sidebar }
