import { createElement as h, useEffect, useState } from 'react'
import { BotAvatar } from '../../marks.js'
import { durationOf } from '../../view-format.js'
import { presenceLines } from './transcript-model.js'

// 在场、排队和叫停只占一行，不写进时间线；数据来自房间投影的 presence / turnQueue / heldMembers。
export function StudioPresence({ room, members, onHold = null }) {
  const { working, queued, held } = presenceLines(room, members)
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    if (working.length === 0) return undefined
    setTick(Date.now())
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working.length, working[0]?.memberId])
  const memberOf = id => members.find(member => member.id === id) ?? null
  const action = (memberId, nextHeld, label) => (
    onHold === null
      ? null
      : h('button', {
        type: 'button',
        className: 'studio-presence-action',
        onClick: () => onHold(memberId, nextHeld),
      }, label)
  )
  if (room?.state !== 'active' || (working.length === 0 && queued.length === 0 && held.length === 0)) return null
  return h('div', { className: 'studio-presence', role: 'status' },
    working.map(item => h('div', { key: `work-${item.memberId}`, className: 'crew-activity-line' },
      h('span', { className: 'studio-presence-avatar' },
        memberOf(item.memberId) === null ? null : h(BotAvatar, { bot: memberOf(item.memberId), size: 22, live: true })),
      h('i', { 'aria-hidden': true }),
      h('span', null, `${item.name} 正在处理`),
      typeof item.since === 'number'
        ? h('span', { className: 'crew-activity-elapsed', 'aria-hidden': 'true' }, durationOf(tick - item.since))
        : null,
      action(item.memberId, true, '叫停'))),
    queued.map(item => h('div', { key: `queue-${item.memberId}`, className: 'studio-queue' },
      h('span', { className: 'studio-presence-avatar' },
        memberOf(item.memberId) === null ? null : h(BotAvatar, { bot: memberOf(item.memberId), size: 18, live: false })),
      h('span', null, `排队 · ${item.name}${item.position !== null && item.of !== null ? `（第 ${item.position} / 共 ${item.of}）` : ''}${item.waitingFor === '' ? '' : ` · 等待 ${item.waitingFor}`}`),
      action(item.memberId, true, '叫停'))),
    held.map(item => h('div', { key: `held-${item.memberId}`, className: 'studio-queue', 'data-held': 'true' },
      h('span', { className: 'studio-presence-avatar' },
        memberOf(item.memberId) === null ? null : h(BotAvatar, { bot: memberOf(item.memberId), size: 18, live: false })),
      h('span', null, `已叫停 · ${item.name}${item.count > 0 ? ` · ${item.count} 条待读` : ''}`),
      action(item.memberId, false, '继续'))))
}
