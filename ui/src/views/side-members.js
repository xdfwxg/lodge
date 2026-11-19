import { createElement as h } from 'react'
import { bodyStatuses } from '../room/body-status.js'
import { uiKindOfRoom } from '../room/kinds.js'
import { openAddMemberDialog, openBodyDialog } from '../room/member-dialog.js'

const IDLE = 'idle'

// 房间下面的成员子目录：待命只留名字和点，有动静才写状态。
export function SideMembers({ room }) {
  const members = Array.isArray(room?.members) ? room.members : []
  if (members.length === 0) return null
  const kind = uiKindOfRoom(room)
  const statuses = bodyStatuses(room, members, { labels: kind.memberLabels })
  const finished = (room.stages ?? []).length > 0 && room.stages.every(stage => stage.state === 'passed')
  const canAdd = kind.membersCanBeAdded === true && room.live === true && !finished &&
    (room.state === 'active' || room.state === 'paused')
  return h('div', { className: 'crew-side-members', role: 'group', 'aria-label': '房间成员' },
    h('span', { className: 'crew-side-members-label' }, '成员'),
    statuses.map(item => h('button', {
      key: item.memberId,
      type: 'button',
      className: 'crew-side-member',
      'data-tone': item.tone,
      title: [item.name, item.state === IDLE ? '' : item.label, item.engine, item.model]
        .filter(value => value !== '').join(' · '),
      onClick: () => openBodyDialog(item.memberId),
    },
    item.state === IDLE ? null : h('span', { className: 'crew-side-member-dot', 'aria-hidden': true }),
    h('span', { className: 'crew-side-member-name' }, item.name),
    item.state === IDLE ? null : h('span', { className: 'crew-side-member-state' }, item.label))),
    canAdd
      ? h('button', {
        type: 'button',
        className: 'crew-side-member crew-side-member-add',
        'aria-label': '添加成员',
        title: '添加成员',
        onClick: openAddMemberDialog,
      }, '+')
      : null)
}
