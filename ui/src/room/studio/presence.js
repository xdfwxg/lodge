import { createElement as h } from 'react'
import { presenceLines } from './transcript-model.js'

// 成员状态只说不打断阅读的事实；叫停这类运行控制收进成员详情，不放在主视线。
export function StudioPresence({ room, members }) {
  const { working, queued, held } = presenceLines(room, members)
  if (room?.state !== 'active' || (working.length === 0 && queued.length === 0 && held.length === 0)) return null
  return h('div', { className: 'studio-presence', role: 'status' },
    working.map(item => h('div', { key: `work-${item.memberId}`, className: 'crew-activity-line' },
      h('span', { className: 'studio-presence-name' }, item.name))),
    queued.map(item => h('div', { key: `queue-${item.memberId}`, className: 'studio-queue' },
      h('span', null, [
        item.name,
        item.position !== null && item.of !== null ? `第 ${item.position} / 共 ${item.of}` : '排队中',
        item.waitingFor === '' ? '' : `等待 ${item.waitingFor}`,
      ].filter(Boolean).join(' · ')))),
    held.map(item => h('div', { key: `held-${item.memberId}`, className: 'studio-queue', 'data-held': 'true' },
      h('span', null, [item.name, item.count > 0 ? `${item.count} 条待读` : '已叫停'].join(' · ')))))
}
