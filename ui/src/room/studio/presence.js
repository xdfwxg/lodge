import { createElement as h } from 'react'
import { presenceLines } from './transcript-model.js'

// 成员的当前状态只由上方的身体状态行说；这里只留能改变下一步的动作：叫停、继续，以及排队细节。
export function StudioPresence({ room, members, onHold = null }) {
  const { working, queued, held } = presenceLines(room, members)
  const action = (memberId, name, nextHeld, label) => (
    onHold === null
      ? null
      : h('button', {
        type: 'button',
        className: 'studio-presence-action',
        'aria-label': `${label}${name}`,
        onClick: () => onHold(memberId, nextHeld),
      }, label)
  )
  if (room?.state !== 'active' || (working.length === 0 && queued.length === 0 && held.length === 0)) return null
  return h('div', { className: 'studio-presence', role: 'status' },
    working.map(item => h('div', { key: `work-${item.memberId}`, className: 'crew-activity-line' },
      h('span', { className: 'studio-presence-name' }, item.name),
      action(item.memberId, item.name, true, '叫停'))),
    queued.map(item => h('div', { key: `queue-${item.memberId}`, className: 'studio-queue' },
      h('span', null, [
        item.name,
        item.position !== null && item.of !== null ? `第 ${item.position} / 共 ${item.of}` : '排队中',
        item.waitingFor === '' ? '' : `等待 ${item.waitingFor}`,
      ].filter(Boolean).join(' · ')),
      action(item.memberId, item.name, true, '叫停'))),
    held.map(item => h('div', { key: `held-${item.memberId}`, className: 'studio-queue', 'data-held': 'true' },
      h('span', null, [item.name, item.count > 0 ? `${item.count} 条待读` : '已叫停'].join(' · ')),
      action(item.memberId, item.name, false, '继续'))))
}
