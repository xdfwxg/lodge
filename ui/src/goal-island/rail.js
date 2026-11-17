import { createElement as h } from 'react'
import { toIslandGoal } from './adapter.js'
import { goalView } from './surface.js'

// 其他房间的目标岛：只露名字、进度和当前段，点一下就过去。
export function IslandRail({ rooms = [], currentId = '', onSelect }) {
  const items = rooms
    .filter(room => room.id !== currentId)
    .filter(room => typeof room.leadMemberId === 'string' && room.leadMemberId !== '' && (room.stages ?? []).length > 0 && room.state === 'active' && room.archivedAt === undefined)
    .map(room => ({ room, view: goalView(toIslandGoal(room)) }))
    .filter(item => item.view !== null)
    // 全部步骤走完又没在等人的房间不进这一行；它们回侧栏就好。
    .filter(item => item.room.needsYou || item.view.segments.some(seg => seg !== 'done'))
    .slice(0, 6)
  if (items.length === 0) return null
  return h('div', { className: 'bt-rail', role: 'list', 'aria-label': '其他房间的目标' },
    h('div', { className: 'bt-rail-track' },
    items.map(({ room, view }) => h('button', {
      key: room.id,
      type: 'button',
      role: 'listitem',
      className: 'bt-rail-island',
      'data-tone': room.needsYou ? 'waiting' : 'active',
      title: `${room.name} · ${view.barLabel}`,
      onClick: () => onSelect?.(room.id),
    },
    h('span', { className: 'bt-rail-name' }, room.name),
    h('span', { className: 'bt-rail-count' }, `${view.number ?? 0}/${view.count}`),
    h('span', { className: 'bt-rail-segs', 'aria-hidden': true },
      view.segments.map((seg, index) => h('i', { key: index, 'data-seg': seg }))),
    room.needsYou ? h('span', { className: 'bt-rail-wait' }, '在等你') : null))))
}
