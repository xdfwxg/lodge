import { Fragment, createElement as h, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from '../overlay.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { initialOf } from '../marks.js'
import { SideMembers } from './side-members.js'
import { deliveredOf, metaOf, roomLabelOf, toneOf } from './room-list.js'

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

function RoomRow({ room, stamp = '', active, onSelect, onRename, onArchive, onDelete, onRounds = null, onHold = null }) {
  const archived = Boolean(room.archivedAt)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAt, setMenuAt] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [membersAt, setMembersAt] = useState(null)
  const [draft, setDraft] = useState(room.name)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const moreRef = useRef(null)
  const menuRef = useRef(null)
  const membersRef = useRef(null)

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

  useEffect(() => {
    if (!membersOpen) return undefined
    const onPointer = event => {
      if (membersRef.current?.contains(event.target) === true) return
      if (moreRef.current?.contains(event.target) === true) return
      setMembersOpen(false)
    }
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setMembersOpen(false)
      moreRef.current?.focus()
    }
    const close = () => setMembersOpen(false)
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
  }, [membersOpen])

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
  const subLine = stamp
  const kind = uiKindOfRoom(room)
  const TypeIcon = kind.icon
  const manage = !lodge && (onRename !== undefined || onArchive !== undefined || onDelete !== undefined)
  const hasMemberPanel = !archived && kind.membersInSidebar === false
  const canDelete = room.state !== 'active' && !room.activeRoundId
  const closeMenu = () => setMenuOpen(false)
  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    const rect = moreRef.current?.getBoundingClientRect()
    if (rect === undefined || rect === null) return
    const width = 144
    const height = 148
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
  const openMembers = () => {
    closeMenu()
    const rect = moreRef.current?.getBoundingClientRect()
    if (rect === undefined || rect === null) return
    const width = 248
    const height = Math.min(320, 56 + (room.members?.length ?? 0) * 30)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const top = rect.bottom + 4 + height > window.innerHeight - 8
      ? Math.max(8, rect.top - height - 4)
      : rect.bottom + 4
    setMembersAt({ top, left })
    setMembersOpen(true)
  }
  return h(Fragment, null,
    h('div', {
      className: 'crew-side-row',
      'data-archived': archived ? 'true' : undefined,
      'data-done': !archived && deliveredOf(room) ? 'true' : undefined,
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
        onKeyDown: event => {
          if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
          if (manage !== true || menuOpen === true) return
          event.preventDefault()
          toggleMenu()
        },
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
        // 行本身已是键盘停靠点；管理菜单用右键菜单键或 Shift+F10 打开，不再多一个 Tab。
        tabIndex: -1,
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
        hasMemberPanel
          ? h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'crew-side-menu-item',
            onClick: openMembers,
          }, '成员')
          : null,
        kind.hasHistory === true && onRounds !== null &&
          ((Array.isArray(room.rounds) && room.rounds.length > 0) || Boolean(room.workRound?.projectId ?? room.defaultProjectId))
          ? h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'crew-side-menu-item',
            onClick: () => { closeMenu(); onRounds() },
          }, '历史')
          : null,
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
    membersOpen && membersAt !== null
      ? createPortal(h('div', {
        ref: membersRef,
        className: 'crew-member-pop',
        style: { top: `${membersAt.top}px`, left: `${membersAt.left}px` },
        role: 'dialog',
        'aria-label': '房间成员',
      }, h(SideMembers, { room, onHold, onClose: () => setMembersOpen(false) })), document.body)
      : null,
    confirm === null ? null : h(RoomConfirm, {
      kind: confirm,
      room,
      busy,
      onCancel: () => setConfirm(null),
      onConfirm: confirm === 'archive' ? () => void archiveNow() : () => void deleteNow(),
    }))
}

export { RoomRow }
