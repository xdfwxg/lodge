import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uiKindOfRoom } from '../room/kinds.js'
import { roomTypeIcon } from '../room/type-icons.js'
import { initialOf } from '../marks.js'

const lastAtOf = room => (room.messages ?? [])
  .reduce((max, message) => Math.max(max, message.ts ?? 0), 0) || room.completedAt || 0
const byRecent = list => [...list].sort((a, b) => lastAtOf(b) - lastAtOf(a))

// Room type is a property of the room, not a section. The sidebar answers
// "what needs me, what have I touched recently, what is done".
export const groupRooms = rooms => {
  const pending = []
  const recent = []
  const done = []
  for (const room of rooms) {
    if (room.needsYou) pending.push(room)
    else if (room.state === 'complete') done.push(room)
    else recent.push(room)
  }
  return [
    { id: 'pending', label: '待处理', rooms: byRecent(pending) },
    { id: 'recent', label: '最近', rooms: byRecent(recent) },
    { id: 'done', label: '已完成', rooms: byRecent(done) },
  ].filter(section => section.rooms.length > 0)
}

const railQuery = () => (
  typeof matchMedia === 'function' ? matchMedia('(max-width:760px)').matches : false
)

function Sidebar({ state, onSelect, onNew }) {
  const { rooms, activeId } = state
  const [rail, setRail] = useState(railQuery)
  const [open, setOpen] = useState(false)
  const sidebarRef = useRef(null)
  const sections = groupRooms(rooms)
  const waiting = sections.find(section => section.id === 'pending')?.rooms.length ?? 0
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

  useEffect(() => {
    let stored = ''
    try { stored = localStorage.getItem('lodge:side-width') ?? '' } catch {}
    const width = Number.parseFloat(stored)
    if (Number.isFinite(width)) document.body.style.setProperty('--crew-side-w', `${clampSide(width)}px`)
    return () => { document.body.style.removeProperty('--crew-side-w') }
  }, [])

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
    setOpen(value => !value)
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
    rail
      ? h('div', {
        className: 'crew-side-scrim',
        onClick: () => setOpen(false),
        'aria-hidden': 'true',
      })
      : null,
    h('aside', { id: 'crew-side', ref: sidebarRef, className: 'dsb-side' },
      rail
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
          title: `Lodge 服务未连接：${state.runtime.error}`,
          'aria-label': `Lodge 服务未连接：${state.runtime.error}`,
        },
        h('span', { className: 'crew-side-error-mark', 'aria-hidden': 'true' }, '!'),
        h('span', { className: 'crew-side-error-text' }, `Lodge 服务未连接：${state.runtime.error}`))
        : null,
      h('div', { className: 'crew-side-tools' },
        waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个待处理`) : h('span'),
        rail
          ? h('button', {
            type: 'button',
            className: 'crew-side-toggle',
            'aria-label': expanded ? '收起侧栏' : '展开侧栏',
            'aria-expanded': expanded,
            'aria-controls': 'crew-side',
            onClick: toggleSide,
          }, expanded ? '«' : '»')
          : null,
        h('button', { type: 'button', className: 'crew-new', 'aria-label': '新建房间', onClick: onNew }, '＋ 新建')),
      h('div', { className: 'bt-side' },
        h('div', { className: 'bt-list' },
          sections.map(section => h('section', { key: section.id, className: 'crew-side-group' },
            h('div', { className: 'crew-side-group-label' }, section.label),
            section.rooms.map(room => h(RoomRow, {
              key: room.id,
              room,
              active: activeId === room.id,
              onSelect: () => selectRoom(room.id),
            })))))),
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

const NEEDS_META = {
  signoff: '待签字',
  review: '待复核',
  decision: '待确认',
  question: '待回答',
  setup: '待设置',
  rework: '待返工',
  merge: '合并冲突',
  parallel: '待处理',
  approval: '待批准',
  idle: '可继续',
  error: '需要处理',
  mcp: '连接中断',
}

// The row only shows a status word when the room needs you. Complete and live
// rooms stay quiet; the dot carries their state and the accessible label says it.
const metaOf = room => room.needsYou ? NEEDS_META[room.needsYou.kind] ?? '待处理' : ''

const stateLabelOf = room => {
  if (room?.state === 'complete') return '完成'
  if (room?.state === 'stopped') return '已停止'
  if (room?.state === 'paused') return '已暂停'
  if (room?.state === 'active') return '进行中'
  return ''
}

// 可达名称：名称 + 状态 + 未读 + needsYou 文案，rail 态不依赖颜色也能读出来。
export const roomLabelOf = room => {
  const meta = metaOf(room)
  const parts = [room?.name ?? '房间']
  if (meta !== '') {
    parts.push(meta)
  } else {
    const state = stateLabelOf(room)
    if (state !== '') parts.push(state)
  }
  if (room?.chatUnread === true) parts.push('有新消息')
  if (room?.needsYou?.label && room.needsYou.label !== meta) parts.push(room.needsYou.label)
  return parts.join('，')
}

function RoomRow({ room, active, onSelect }) {
  const label = roomLabelOf(room)
  const TypeIcon = roomTypeIcon(uiKindOfRoom(room).id)
  return h('button', {
    type: 'button',
    className: 'bt-row crew-side-room',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
    title: label,
    'aria-label': label,
  },
  h('span', { className: 'crew-side-room-badge', 'aria-hidden': 'true' }, initialOf(room.name, '·')),
  h('span', { className: 'crew-side-room-type', 'aria-hidden': 'true' }, h(TypeIcon, { size: 15 })),
  h('span', { className: 'crew-side-room-name' }, room.name),
  room.chatUnread === true && !active
    ? h('span', { className: 'crew-unread-dot', title: '聊天有新消息' }, h('span', { className: 'visually-hidden' }, '聊天有新消息'))
    : null,
  metaOf(room) === '' ? null : h('span', { className: 'crew-side-room-meta', 'data-tone': toneOf(room) }, metaOf(room)),
  h('span', { className: 'crew-side-room-dot', 'data-tone': toneOf(room), title: room.needsYou?.label ?? '' }))
}

export { Sidebar }
