import { createElement as h, useEffect, useState } from 'react'
import { durationOf } from '../view-format.js'
import { bodyStatuses } from './body-status.js'

// 一行成员状态：谁在线、谁在工作、谁在等、谁不舒服。位置沿用原来的活动行。
export function CrewStatusLine({ room, members, onSwap = null, onAdd = null, labels = {} }) {
  const statuses = bodyStatuses(room, members, { labels })
  const working = statuses.some(item => item.state === 'working')
  const since = typeof room?.busySince === 'number' ? room.busySince : null
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    if (!working || since === null) return undefined
    setTick(Date.now())
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working, since])
  if (room?.state !== 'active' && room?.state !== 'paused') return null
  if (statuses.length === 0) return null
  const elapsed = since === null ? '' : durationOf(tick - since)
  return h('div', {
    className: 'crew-crew-status',
    role: 'group',
    'aria-label': '成员状态',
  },
  statuses.map(item => h(onSwap === null ? 'span' : 'button', {
    key: item.memberId,
    ...(onSwap === null ? {} : {
      type: 'button',
      onClick: () => onSwap(item.memberId),
      'aria-label': `给${item.name}换身体`,
    }),
    className: 'crew-crew-member',
    'data-tone': item.tone,
    title: [item.engine, item.model, item.label, onSwap === null ? '' : '点击换身体'].filter(value => value !== '').join(' · '),
  },
  h('span', { className: 'crew-crew-dot', 'aria-hidden': 'true' }),
  h('span', { className: 'crew-crew-name' }, item.name),
  h('span', { className: 'crew-crew-state' }, item.label),
  item.state === 'working' && elapsed !== '' && elapsed !== '0s'
    ? h('span', { className: 'crew-crew-elapsed', 'aria-hidden': 'true' }, elapsed)
    : null)),
  onAdd === null
    ? null
    : h('button', {
      type: 'button',
      className: 'crew-crew-add',
      onClick: onAdd,
    }, '＋ 添加成员'))
}
