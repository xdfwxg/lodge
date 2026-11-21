import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from '../overlay.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { initialOf } from '../marks.js'
import { routineLineOf } from '../../../shared/routine.js'
import { stripAttachmentTags } from '../../../shared/attachments.js'
import { humanErrorText } from '../error-text.js'
import { SideMembers } from './side-members.js'
import { ProfileMark } from '../profile-mark.js'
import { PlusIcon } from '../icons.js'
import { clampSide, COLLAPSE_AT, RAIL_WIDTH, readSidebarLayout, SIDE_MAX, SIDE_MIN, writeSidebarCollapsed, writeSidebarWidth } from '../app/sidebar-layout.js'

const lastAtOf = room => (room.messages ?? [])
  .reduce((max, message) => Math.max(max, message.ts ?? 0), 0) || room.completedAt || 0
const byRecent = list => [...list].sort((a, b) => lastAtOf(b) - lastAtOf(a))

const pad = value => String(value).padStart(2, '0')
const stampOf = ts => {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 名字来自目标，相似目标会撞名；只在撞名时补一行时间，平时不打扰。
export const roomStampOf = (rooms, room) => {
  const sameName = (rooms ?? []).filter(item => !item.archivedAt && item.name === room?.name)
  return sameName.length > 1 ? stampOf(lastAtOf(room)) : ''
}

// 一条列表：先放待处理的，再放最近、完成、归档。类型不是分区。
export const orderRooms = rooms => {
  const pending = []
  const recent = []
  const done = []
  const archived = []
  for (const room of rooms) {
    if (room.archivedAt) archived.push(room)
    else if (room.needsYou) pending.push(room)
    else if (room.state === 'complete') done.push(room)
    else recent.push(room)
  }
  return [...byRecent(pending), ...byRecent(recent), ...byRecent(done), ...byRecent(archived)]
}

export const SEARCH_MIN_ROOMS = 7

export const filterRooms = (rooms, query) => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return rooms
  return rooms.filter(room => [
    room.name,
    stripAttachmentTags(room.goal),
    roomLabelOf(room),
    room.needsYou?.label,
  ].some(value => typeof value === 'string' && value.toLowerCase().includes(needle)))
}

const railQuery = () => (
  typeof matchMedia === 'function' ? matchMedia('(max-width:760px)').matches : false
)

function Sidebar({ state, onSelect, onNew, onRename, onArchive, onDelete, onHoldMember = null, lodgeRoom = null, profile = null, onProfile = null }) {
  const { rooms, activeId } = state
  const [rail, setRail] = useState(railQuery)
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [open, setOpen] = useState(false)
  const [sideWidth, setSideWidthPx] = useState(248)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const sidebarRef = useRef(null)
  const searchRef = useRef(null)
  const collapsedRef = useRef(false)
  const liveCount = rooms.filter(room => !room.archivedAt).length
  const showSearch = liveCount >= SEARCH_MIN_ROOMS || searchOpen || query.trim() !== ''
  const ordered = orderRooms(filterRooms(rooms, query))
  const archivedRooms = ordered.filter(room => room.archivedAt)
  const activeRooms = ordered.filter(room => !room.archivedAt)
  const regularRooms = lodgeRoom === null ? activeRooms : activeRooms.filter(room => room.id !== lodgeRoom.id)
  const hasRail = rail || sideCollapsed
  const collapsed = hasRail && !open
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
    if (!hasRail) setOpen(false)
  }, [hasRail])

  // 搜索框第一次出现时由 effect 接管焦点，避免 setState 与 RAF 抢时序。
  useEffect(() => {
    if (searchOpen && searchRef.current !== null) searchRef.current.focus()
  }, [searchOpen])

  useEffect(() => {
    const focusSearch = () => {
      setSearchOpen(true)
      setOpen(true)
      searchRef.current?.focus()
    }
    const onKeyDown = event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'f') return
      if (document.querySelector('[role=dialog]') !== null) return
      event.preventDefault()
      focusSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('lodge:focus-search', focusSearch)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('lodge:focus-search', focusSearch)
    }
  }, [])

  useEffect(() => {
    const stored = readSidebarLayout()
    if (stored.width !== null) {
      document.body.style.setProperty('--crew-side-w', `${stored.width}px`)
      setSideWidthPx(stored.width)
    }
    if (stored.collapsed) {
      collapsedRef.current = true
      setSideCollapsed(true)
    }
    return () => { document.body.style.removeProperty('--crew-side-w') }
  }, [])

  useLayoutEffect(() => {
    if (!hasRail) delete document.body.dataset.side
    else document.body.dataset.side = open ? 'open' : 'rail'
    return () => { delete document.body.dataset.side }
  }, [hasRail, open])

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

  const roomRow = room => h(RoomRow, {
    key: room.id,
    room,
    stamp: roomStampOf(rooms, room),
    active: activeId === room.id,
    onSelect: () => selectRoom(room.id),
    onRename: onRename === undefined ? undefined : name => onRename(room.id, name),
    onArchive: onArchive === undefined ? undefined : archived => onArchive(room.id, archived),
    onDelete: onDelete === undefined ? undefined : () => onDelete(room.id),
  })
  const renderRoom = room => h(Fragment, { key: room.id },
    roomRow(room),
    activeId === room.id ? h(SideMembers, { room, onHold: onHoldMember }) : null)

  // 拖右侧竖线改宽度；宽度由 sidebar-layout 持久化。拖到一列图标时收成 rail。
  const setCollapsed = value => {
    if (collapsedRef.current === value) return
    collapsedRef.current = value
    setSideCollapsed(value)
    writeSidebarCollapsed(value)
  }
  const setSideWidth = width => {
    const raw = Math.round(width)
    if (raw < COLLAPSE_AT) {
      setCollapsed(true)
      return
    }
    setCollapsed(false)
    const value = clampSide(raw)
    document.body.style.setProperty('--crew-side-w', `${value}px`)
    setSideWidthPx(value)
    writeSidebarWidth(value)
  }
  const startResize = event => {
    if (event.button !== 0 || sidebarRef.current === null) return
    event.preventDefault()
    setOpen(false)
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
    if (sideCollapsed && event.key === 'ArrowRight') {
      event.preventDefault()
      setSideWidth(SIDE_MIN)
      return
    }
    if (sideCollapsed && event.key === 'ArrowLeft') {
      event.preventDefault()
      return
    }
    const current = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--crew-side-w')) || 248
    const next = event.key === 'ArrowLeft' ? current - 16
      : event.key === 'ArrowRight' ? current + 16
        : event.key === 'Home' ? (sideCollapsed ? RAIL_WIDTH : SIDE_MIN)
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

  const newButton = () => h('button', {
    type: 'button',
    className: 'crew-new crew-new-icon',
    'aria-label': '新建房间',
    title: '新建房间',
    onClick: () => onNew(),
  }, h(PlusIcon))

  return h(Fragment, null,
    hasRail
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
          'aria-valuenow': collapsed ? RAIL_WIDTH : sideWidth,
          'aria-valuemin': collapsed ? RAIL_WIDTH : SIDE_MIN,
          'aria-valuemax': SIDE_MAX,
          tabIndex: 0,
          onPointerDown: startResize,
          onKeyDown: resizeWithKeyboard,
        }),
      h('div', { className: 'crew-side-brand-row' },
        h('button', {
          type: 'button',
          className: 'crew-side-brand',
          'aria-label': 'Lodge，对话',
          title: '回到 Lodge',
          onClick: lodgeRoom === null ? undefined : () => selectRoom(lodgeRoom.id),
        },
        h('span', { className: 'crew-side-wordmark' }, 'Lodge'),
        h('span', { className: 'crew-side-monogram', 'aria-hidden': 'true' }, 'L')),
        rail
          ? null
          : newButton()),
      state.runtime?.ok === false
        ? h('div', {
          className: 'crew-error crew-side-error',
          role: 'alert',
          title: humanErrorText(state.runtime.error, 'Lodge 没连上，稍后自动重试'),
          'aria-label': humanErrorText(state.runtime.error, 'Lodge 没连上，稍后自动重试'),
        },
        h('span', { className: 'crew-side-error-mark', 'aria-hidden': 'true' }, '!'),
        h('span', { className: 'crew-side-error-text' }, humanErrorText(state.runtime.error, 'Lodge 没连上，稍后自动重试')))
        : null,
      rail
        ? h('div', { className: 'crew-side-tools' },
          newButton(),
          h('button', {
            type: 'button',
            className: 'crew-side-toggle',
            'aria-label': expanded ? '收起侧栏' : '展开侧栏',
            'aria-expanded': expanded,
            'aria-controls': 'crew-side',
            onClick: toggleSide,
          }, expanded ? '«' : '»'))
        : null,
      showSearch && !collapsed
        ? h('div', { className: 'crew-side-search' },
          h('input', {
            ref: searchRef,
            type: 'search',
            className: 'crew-side-search-input',
            placeholder: '搜索房间',
            'aria-label': '搜索房间',
            value: query,
            onChange: event => setQuery(event.target.value),
            onKeyDown: event => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (query !== '') {
                setQuery('')
                return
              }
              if (liveCount < SEARCH_MIN_ROOMS) {
                setSearchOpen(false)
                event.currentTarget.blur()
              }
            },
          }))
        : null,
      h('div', { className: 'bt-side' },
        h('div', { className: 'bt-list' },
          query.trim() !== '' && regularRooms.length === 0 && archivedRooms.length === 0
            ? h('p', { className: 'crew-side-empty', role: 'status' }, '没有匹配的房间')
            : null,
          regularRooms.map(renderRoom),
          archivedRooms.length === 0
            ? null
            : h('div', { key: 'archived-label', className: 'crew-side-group-label' }, '已归档'),
          archivedRooms.map(room => roomRow(room)))),
      profile === null || onProfile === null
        ? null
        : h('button', {
          type: 'button',
          className: 'crew-side-me',
          'aria-label': profile.name,
          onClick: onProfile,
        },
        h('span', { className: 'crew-side-me-avatar', 'aria-hidden': 'true' },
          h(ProfileMark, { profile })),
        collapsed
          ? null
          : h('span', { className: 'crew-side-me-name' }, profile.name),
        collapsed
          ? null
          : h('span', { className: 'crew-side-me-more', 'aria-hidden': 'true' }, '›'))))
}

const toneOf = room => {
  if (room.needsYou?.kind === 'review') return 'review'
  if (room.needsYou?.kind === 'signoff' || room.needsYou?.kind === 'result') return 'done'
  if (room.needsYou?.kind === 'routine-run') return 'waiting'
  if (room.needsYou?.kind === 'rework' || room.needsYou?.kind === 'merge' || room.needsYou?.kind === 'parallel') return 'alert'
  if (room.needsYou) return 'waiting'
  if (room.state === 'complete') return 'done'
  return room.live === true ? 'active' : 'idle'
}

const NEEDS_META = {
  result: '看结果',
  'routine-run': '待处理',
  signoff: '待签字',
  review: '验收员在看',
  decision: '待确认',
  question: '待回答',
  setup: '补检查',
  rework: '待重做',
  merge: '待处理冲突',
  parallel: '待处理',
  approval: '待确认',
  idle: '可以继续',
  error: '没做成',
  mcp: '连接中断',
  connection: '连接中断',
  blocked: '待处理',
}

// The row only shows a status word when the room needs you. Complete and live
// rooms stay quiet; the dot carries their state and the accessible label says it.
const metaOf = room => room.archivedAt ? '' : room.needsYou ? NEEDS_META[room.needsYou.kind] ?? '待处理' : ''

const stateLabelOf = room => {
  if (room?.archivedAt) return '已归档'
  if (room?.state === 'complete') return room?.modeCapabilities?.stages === false ? '已确认' : '已交付'
  if (room?.state === 'idle') return '空闲'
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

function RoomConfirm({ kind, room, busy, onCancel, onConfirm }) {
  const deleting = kind === 'delete'
  const dismiss = () => {
    if (!busy) onCancel()
  }
  const overlay = useOverlay({ label: deleting ? '删除房间' : '归档房间', onClose: dismiss, active: true })
  return h('div', { className: 'crew-overlay crew-overlay-center', onClick: dismiss, ...overlay },
    h('div', { className: 'crew-dialog crew-confirm', onClick: event => event.stopPropagation() },
      h('div', { className: 'crew-dialog-heading crew-confirm-body' },
        h('h2', null, deleting ? '删除这间房？' : '归档这间房？'),
        h('p', null, deleting
          ? '记录和过程档案会被删除，不能恢复。文件留着。'
          : '收进「已归档」，随时可以恢复。')),
      h('div', { className: 'crew-dialog-foot' },
        h('button', { type: 'button', className: 'crew-ghost', disabled: busy, autoFocus: true, onClick: dismiss }, '取消'),
        h('button', {
          type: 'button',
          className: 'crew-accept crew-dialog-primary',
          'data-danger': deleting ? 'true' : undefined,
          disabled: busy,
          onClick: onConfirm,
        }, busy ? '正在处理…' : deleting ? '删除' : '归档'))))
}

function RoomRow({ room, stamp = '', active, onSelect, onRename, onArchive, onDelete }) {
  const archived = Boolean(room.archivedAt)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAt, setMenuAt] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(room.name)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const moreRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => { setDraft(room.name) }, [room.name])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onPointer = event => {
      if (menuRef.current?.contains(event.target) === true) return
      if (moreRef.current?.contains(event.target) === true) return
      setMenuOpen(false)
    }
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setMenuOpen(false)
      moreRef.current?.focus()
    }
    const close = () => setMenuOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen || menuRef.current === null) return
    const first = menuRef.current.querySelector('[role=menuitem]:not([disabled])')
    first?.focus()
  }, [menuOpen])

  const menuKeyDown = event => {
    const items = [...(menuRef.current?.querySelectorAll('[role=menuitem]:not([disabled])') ?? [])]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length
      : event.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : null
    if (next === null) return
    event.preventDefault()
    items[next].focus()
  }

  const lodge = room.lodge === true
  const label = stamp === '' ? roomLabelOf(room) : `${roomLabelOf(room)}，${stamp}`
  const routineLine = room.archivedAt || room.needsYou ? '' : routineLineOf(room)
  const subLine = routineLine === ''
    ? stamp
    : stamp === '' ? routineLine : `${routineLine} · ${stamp}`
  const TypeIcon = uiKindOfRoom(room).icon
  const manage = !lodge && (onRename !== undefined || onArchive !== undefined || onDelete !== undefined)
  const canDelete = room.state !== 'active'
  const closeMenu = () => setMenuOpen(false)
  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = moreRef.current?.getBoundingClientRect()
    if (rect === undefined || rect === null) return
    const width = 144
    const height = 112
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const top = rect.bottom + height > window.innerHeight - 8
      ? Math.max(8, rect.top - height - 4)
      : rect.bottom + 4
    setMenuAt({ top, left })
    setMenuOpen(true)
  }
  const startRename = () => {
    setDraft(room.name)
    setRenaming(true)
    setNote('')
    closeMenu()
  }
  const cancelRename = () => {
    setDraft(room.name)
    setRenaming(false)
  }
  const submitRename = async () => {
    const text = draft.trim()
    if (busy || onRename === undefined) return
    if (text === '' || text === room.name) {
      setRenaming(false)
      return
    }
    setBusy(true)
    setNote('')
    const result = await onRename(text)
    setBusy(false)
    if (result?.ok === true) setRenaming(false)
    else setNote(result?.error ?? '名字没能改过来')
  }
  const archiveNow = async () => {
    if (busy || onArchive === undefined) return
    setBusy(true)
    setNote('')
    const result = await onArchive(true)
    setBusy(false)
    setConfirm(null)
    if (result?.ok !== true) setNote(result?.error ?? '没能归档')
  }
  const restore = async () => {
    if (busy || onArchive === undefined) return
    setBusy(true)
    setNote('')
    const result = await onArchive(false)
    setBusy(false)
    closeMenu()
    if (result?.ok !== true) setNote(result?.error ?? '没能取消归档')
  }
  const deleteNow = async () => {
    if (busy || onDelete === undefined) return
    setBusy(true)
    setNote('')
    const result = await onDelete()
    setBusy(false)
    setConfirm(null)
    if (result?.ok !== true) setNote(result?.error ?? '没能删除')
  }
  const requestArchive = () => {
    closeMenu()
    if (room.state === 'active') setConfirm('archive')
    else void archiveNow()
  }
  const requestDelete = () => {
    closeMenu()
    setConfirm('delete')
  }
  return h(Fragment, null,
    h('div', {
      className: 'crew-side-row',
      'data-archived': archived ? 'true' : undefined,
      'data-done': !archived && room.state === 'complete' ? 'true' : undefined,
      'data-needs': room.needsYou === undefined || room.needsYou === null ? undefined : 'true',
      'data-menu': menuOpen ? 'true' : undefined,
    },
    renaming
      ? h('form', {
        className: 'crew-side-rename',
        onSubmit: event => {
          event.preventDefault()
          void submitRename()
        },
      },
      h('input', {
        className: 'crew-side-rename-input',
        value: draft,
        autoFocus: true,
        maxLength: 60,
        disabled: busy,
        'aria-label': '房间名',
        onChange: event => setDraft(event.target.value),
        onKeyDown: event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          cancelRename()
        },
      }),
      h('button', { type: 'submit', className: 'crew-side-rename-save', disabled: busy || draft.trim() === '' }, busy ? '保存中…' : '保存'),
      h('button', { type: 'button', className: 'crew-side-rename-cancel', disabled: busy, onClick: cancelRename }, '取消'))
      : h('button', {
        type: 'button',
        className: 'bt-row crew-side-room',
        'aria-current': active ? 'page' : undefined,
        onClick: onSelect,
        title: label,
        'aria-label': label,
      },
      h('span', { className: 'crew-side-room-badge', 'aria-hidden': 'true' }, lodge ? h('img', { src: '/logo.svg', alt: '', width: 18, height: 18 }) : initialOf(room.name, '·')),
      h('span', { className: 'crew-side-room-type', 'aria-hidden': 'true' }, lodge ? null : h(TypeIcon, { size: 15 })),
      h('span', { className: 'crew-side-room-text' },
        h('span', { className: 'crew-side-room-title' },
          h('span', { className: 'crew-side-room-name' }, room.name)),
        subLine === '' ? null : h('span', { className: 'crew-side-room-next' }, subLine)),
      room.chatUnread === true && !active
        ? h('span', { className: 'crew-unread-dot', title: '聊天有新消息' }, h('span', { className: 'visually-hidden' }, '聊天有新消息'))
        : null,
      active || metaOf(room) === '' ? null : h('span', { className: 'crew-side-room-meta', 'data-tone': toneOf(room) }, metaOf(room)),
      h('span', { className: 'crew-side-room-dot', 'data-tone': toneOf(room), title: room.needsYou?.label ?? '' })),
    manage && !renaming
      ? h('button', {
        ref: moreRef,
        type: 'button',
        className: 'crew-side-more',
        'aria-label': stamp === '' ? `管理 ${room.name}` : `管理 ${room.name}，${stamp}`,
        'aria-haspopup': 'menu',
        'aria-expanded': menuOpen,
        onClick: toggleMenu,
      }, '⋯')
      : null,
    menuOpen && menuAt !== null
      ? createPortal(h('div', {
        ref: menuRef,
        className: 'crew-side-menu',
        style: { top: `${menuAt.top}px`, left: `${menuAt.left}px` },
        role: 'menu',
        'aria-label': `${room.name}的操作`,
        onKeyDown: menuKeyDown,
      },
        onRename === undefined ? null : h('button', {
          type: 'button', role: 'menuitem', className: 'crew-side-menu-item', onClick: startRename,
        }, '重命名'),
        onArchive === undefined ? null : h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'crew-side-menu-item',
          disabled: busy,
          onClick: archived ? () => void restore() : requestArchive,
        }, archived ? '取消归档' : '归档'),
        onDelete === undefined ? null : h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'crew-side-menu-item crew-side-menu-danger',
          disabled: busy || !canDelete,
          title: canDelete ? undefined : '先归档再删除',
          onClick: requestDelete,
        }, '删除…')), document.body)
      : null,
    note === '' ? null : h('p', { className: 'crew-side-row-note', role: 'alert' }, note)),
    confirm === null ? null : h(RoomConfirm, {
      kind: confirm,
      room,
      busy,
      onCancel: () => setConfirm(null),
      onConfirm: confirm === 'archive' ? () => void archiveNow() : () => void deleteNow(),
    }))
}

export { Sidebar }
