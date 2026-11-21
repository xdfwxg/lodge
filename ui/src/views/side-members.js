import { createElement as h, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bodyStatuses } from '../room/body-status.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { openAddMemberDialog, openBodyDialog } from '../room/member-dialog.js'

const IDLE = 'idle'

// 房间下面的成员子目录：待命只留名字和点，有动静才写状态。
// 停止仍然是房间那一个按钮；这里只在成员菜单里放「先别给 TA 派活」这个持久开关。
export function SideMembers({ room, onHold = null }) {
  const members = Array.isArray(room?.members) ? room.members : []
  const [menu, setMenu] = useState(null)
  const moreRef = useRef(null)
  useEffect(() => {
    if (menu === null) return undefined
    const close = () => setMenu(null)
    const onKey = event => { if (event.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])
  if (members.length === 0) return null
  const kind = uiKindOfRoom(room)
  const statuses = bodyStatuses(room, members, { labels: kind.memberLabels })
  const finished = (room.stages ?? []).length > 0 && room.stages.every(stage => stage.state === 'passed')
  const canAdd = kind.membersCanBeAdded === true && room.live === true && !finished &&
    (room.state === 'active' || room.state === 'paused')
  const canHold = room.state === 'active' && room.live === true && typeof onHold === 'function'
  const held = new Set(Array.isArray(room.heldMembers) ? room.heldMembers : [])
  const openMenu = (item, event) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ memberId: item.memberId, held: held.has(item.memberId), x: rect.right - 132, y: rect.bottom + 4 })
  }
  const choose = action => {
    setMenu(null)
    action()
  }
  return h('div', { className: 'crew-side-members', role: 'group', 'aria-label': '房间成员' },
    h('span', { className: 'crew-side-members-label' }, '成员'),
    statuses.map(item => h('span', { key: item.memberId, className: 'crew-side-member-row' },
      h('button', {
        type: 'button',
        className: 'crew-side-member',
        'data-tone': item.tone,
        title: [item.name, item.state === IDLE ? '' : item.label, item.engine, item.model]
          .filter(value => value !== '').join(' · '),
        onClick: () => openBodyDialog(item.memberId),
      },
      item.state === IDLE ? null : h('span', { className: 'crew-side-member-dot', 'aria-hidden': true }),
      h('span', { className: 'crew-side-member-name' }, item.name),
      item.state === IDLE ? null : h('span', { className: 'crew-side-member-state' }, item.label)),
      canHold
        ? h('button', {
          type: 'button',
          ref: moreRef,
          className: 'crew-side-member-more',
          'aria-label': `${item.name}的更多操作`,
          'aria-haspopup': 'menu',
          onClick: event => openMenu(item, event),
        }, '⋯')
        : null)),
    canAdd
      ? h('button', {
        type: 'button',
        className: 'crew-side-member crew-side-member-add',
        'aria-label': '添加成员',
        title: '添加成员',
        onClick: openAddMemberDialog,
      }, '+')
      : null,
    menu === null
      ? null
      : createPortal(h('div', {
        className: 'crew-side-menu crew-member-menu',
        role: 'menu',
        style: { left: `${menu.x}px`, top: `${menu.y}px` },
        onMouseDown: event => event.stopPropagation(),
      },
      h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'crew-side-menu-item',
        onClick: () => choose(() => openBodyDialog(menu.memberId)),
      }, '调整成员'),
      h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'crew-side-menu-item',
        onClick: () => choose(() => onHold(menu.memberId, !menu.held)),
      }, menu.held ? '继续派活' : '先别给 TA 派活')), document.body))
}
