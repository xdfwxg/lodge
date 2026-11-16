import { createElement as h, useEffect, useState } from 'react'
import { BotAvatar } from '../../marks.js'
import { durationOf } from '../../view-format.js'
import { presenceLines } from './transcript-model.js'

// 在场、排队和叫停只占一行，不写进时间线；数据来自房间投影的 presence / turnQueue / heldSeats。
export function StudioPresence({ room, seats, onHold = null }) {
  const { working, queued, held } = presenceLines(room, seats)
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    if (working.length === 0) return undefined
    setTick(Date.now())
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working.length, working[0]?.seatId])
  const seatOf = id => seats.find(seat => seat.id === id) ?? null
  const action = (seatId, nextHeld, label) => (
    onHold === null
      ? null
      : h('button', {
        type: 'button',
        className: 'studio-presence-action',
        onClick: () => onHold(seatId, nextHeld),
      }, label)
  )
  if (room?.state !== 'active' || (working.length === 0 && queued.length === 0 && held.length === 0)) return null
  return h('div', { className: 'studio-presence', role: 'status' },
    working.map(item => h('div', { key: `work-${item.seatId}`, className: 'crew-activity-line' },
      h('span', { className: 'studio-presence-avatar' },
        seatOf(item.seatId) === null ? null : h(BotAvatar, { bot: seatOf(item.seatId), size: 22, live: true })),
      h('i', { 'aria-hidden': true }),
      h('span', null, `${item.name} 正在处理`),
      typeof item.since === 'number'
        ? h('span', { className: 'crew-activity-elapsed', 'aria-hidden': 'true' }, durationOf(tick - item.since))
        : null,
      action(item.seatId, true, '叫停'))),
    queued.map(item => h('div', { key: `queue-${item.seatId}`, className: 'studio-queue' },
      h('span', { className: 'studio-presence-avatar' },
        seatOf(item.seatId) === null ? null : h(BotAvatar, { bot: seatOf(item.seatId), size: 18, live: false })),
      h('span', null, `排队 · ${item.name}${item.position !== null && item.of !== null ? `（第 ${item.position} / 共 ${item.of}）` : ''}${item.waitingFor === '' ? '' : ` · 等待 ${item.waitingFor}`}`),
      action(item.seatId, true, '叫停'))),
    held.map(item => h('div', { key: `held-${item.seatId}`, className: 'studio-queue', 'data-held': 'true' },
      h('span', { className: 'studio-presence-avatar' },
        seatOf(item.seatId) === null ? null : h(BotAvatar, { bot: seatOf(item.seatId), size: 18, live: false })),
      h('span', null, `已叫停 · ${item.name}`),
      action(item.seatId, false, '继续'))))
}
