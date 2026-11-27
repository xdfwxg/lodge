import { Fragment, createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uiKindOfRoom } from '../room/kinds.js'
import { humanErrorText } from '../error-text.js'
import { SideMembers } from './side-members.js'
import { ProfileMark } from '../profile-mark.js'
import { PlusIcon } from '../icons.js'
import { clampSide, COLLAPSE_AT, RAIL_WIDTH, readSidebarLayout, SIDE_MAX, SIDE_MIN, writeSidebarCollapsed, writeSidebarWidth } from '../app/sidebar-layout.js'
import { filterRooms, orderRooms, roomStampOf, SEARCH_MIN_ROOMS } from './room-list.js'
import { RoomRow } from './room-row.js'

const railQuery = () => (
  typeof matchMedia === 'function' ? matchMedia('(max-width:760px)').matches : false
)

function Sidebar({ state, onSelect, onNew, onRename, onArchive, onDelete, onRounds = null, onHoldMember = null, engines = [], onSwapBody = null, onPolicy = null, onWebhook = null, lodgeRoom = null, profile = null, onProfile = null }) {
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
    onRounds: onRounds === undefined || onRounds === null ? null : () => onRounds(room.id),
    onHold: onHoldMember,
    engines,
    onSwapBody,
    onPolicy: onPolicy === undefined || onPolicy === null ? null : policy => onPolicy(room.id, policy),
    onWebhook: onWebhook === undefined || onWebhook === null ? null : (id, action) => onWebhook(id, action),
  })
  const renderRoom = room => h(Fragment, { key: room.id },
    roomRow(room),
    activeId === room.id && uiKindOfRoom(room).membersInSidebar === true
      ? h(SideMembers, { room, engines, onSwapBody, onHold: onHoldMember })
      : null)

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
          title: humanErrorText(state.runtime.error, '模型服务没连上，稍后自动重试'),
          'aria-label': humanErrorText(state.runtime.error, '模型服务没连上，稍后自动重试'),
        },
        h('span', { className: 'crew-side-error-mark', 'aria-hidden': 'true' }, '!'),
        h('span', { className: 'crew-side-error-text' }, humanErrorText(state.runtime.error, '模型服务没连上，稍后自动重试')))
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

export { Sidebar }
