import { createElement as h, useEffect, useState } from 'react'
import { durationOf } from '../../view-format.js'
import { presenceLines } from './transcript-model.js'

// 在场与排队只占一行，不写进时间线；数据来自房间投影的 presence / turnQueue。
export function StudioPresence({ room, seats }) {
  const { working, queued } = presenceLines(room, seats)
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    if (working.length === 0) return undefined
    setTick(Date.now())
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working.length, working[0]?.seatId])
  if (room?.state !== 'active' || (working.length === 0 && queued.length === 0)) return null
  return h('div', { className: 'studio-presence', role: 'status' },
    working.map(item => h('div', { key: `work-${item.seatId}`, className: 'crew-activity-line' },
      h('i', { 'aria-hidden': true }),
      h('span', null, `${item.name} 正在处理`),
      typeof item.since === 'number'
        ? h('span', { className: 'crew-activity-elapsed' }, durationOf(tick - item.since))
        : null)),
    queued.map(item => h('div', { key: `queue-${item.seatId}`, className: 'studio-queue' },
      `排队 · ${item.name}${item.position !== null && item.of !== null ? `（第 ${item.position} / 共 ${item.of}）` : ''}${item.waitingFor === '' ? '' : ` · 等待 ${item.waitingFor}`}`)))
}
