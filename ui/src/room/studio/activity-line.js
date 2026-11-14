import { createElement as h, useEffect, useState } from 'react'
import { durationOf } from '../../view-format.js'

// 工作室唯一的活动行：谁在做什么、做了多久，旁边一个暂停。
export function StudioActivityLine({ text, since, onPause }) {
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    if (text === '' || typeof since !== 'number') return undefined
    setTick(Date.now())
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [text, since])
  if (text === '') return null
  const elapsed = typeof since === 'number' ? durationOf(tick - since) : ''
  return h('div', { className: 'crew-activity-line', role: 'status' },
    h('i', { 'aria-hidden': true }),
    h('span', null, text),
    elapsed === '' || elapsed === '0s'
      ? null
      : h('span', { className: 'crew-activity-elapsed' }, elapsed),
    onPause === undefined
      ? null
      : h('button', { type: 'button', className: 'crew-activity-action', onClick: onPause }, '暂停'))
}
