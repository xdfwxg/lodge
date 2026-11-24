import { createElement as h, useEffect, useState } from 'react'
import { timeOf } from '../../view-format.js'
import { healthOf, toolLabelOf } from '../health.js'

const KIND_LABEL = { read: '读', write: '写', exec: '跑', gate: '判' }

const elapsedOf = (from, now) => {
  if (!Number.isFinite(from)) return ''
  const seconds = Math.max(0, Math.floor((now - from) / 1000))
  if (seconds < 3) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

// 一次工具调用不是一条发言；连着的几次调用收成时间线里的一行，收起时也能看到刚做了什么。
// 折起来是“执行官 · 12 次操作 · 跑了 npm test · 2:40”，展开才是每一步。
export function ProcessGroup({ room, activities, member, isLatest = false, onForgetMemory = null }) {
  const health = isLatest ? healthOf(room) : null
  const last = activities[activities.length - 1] ?? null
  const open = isLatest && (Array.isArray(room?.assignments) ? room.assignments : [])
    .some(item => (item?.status === 'sent' || item?.status === 'working') && item.toMemberId === last?.authorId)
  const live = isLatest && room?.state === 'active' && room?.needsYou == null && (open || Date.now() - (last?.ts ?? 0) < 5 * 60_000)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [live])
  const labels = activities.map(toolLabelOf)
  const what = labels.length === 1 ? labels[0] : `${labels.length} 次操作 · ${labels[labels.length - 1]}`
  const elapsed = live ? elapsedOf(last?.ts, now) : ''
  const metrics = isLatest && health !== null
    ? [
      health.usage,
      health.reworks > 0 ? `重做 ${health.reworks} 次` : '',
      health.human > 0 ? `你介入 ${health.human} 次` : '',
      health.memoryCount > 0 ? `参考 ${health.memoryCount} 条记忆` : '',
    ].filter(Boolean).join(' · ')
    : ''
  return h('details', { className: 'crew-fold crew-process' },
    h('summary', null,
      live ? h('span', { className: 'crew-process-live', 'aria-hidden': true }) : null,
      h('span', { className: 'crew-process-summary' },
        member?.name ?? '成员',
        ` · ${what}`,
        elapsed === '' ? null : ` · ${elapsed}`)),
    h('div', { className: 'crew-process-body' },
      h('ul', null, activities.map(activity => h('li', {
        key: activity.id,
        className: 'crew-tool-row',
        'data-ok': activity.meta?.ok === false ? 'false' : 'true',
      },
      h('span', { className: 'crew-tool-kind', 'data-kind': String(activity.meta?.action ?? ''), 'aria-hidden': 'true' }, KIND_LABEL[String(activity.meta?.action ?? '')] ?? '·'),
      h('span', { className: 'crew-tool-label' }, toolLabelOf(activity)),
      h('span', { className: 'crew-tool-time' }, timeOf(activity.ts)),
      h('span', { className: 'crew-tool-state', 'data-ok': activity.meta?.ok === false ? 'false' : 'true' }, activity.meta?.ok === false ? '失败' : '')))),
      metrics === '' ? null : h('p', { className: 'crew-process-meta' }, metrics),
      health !== null && health.memoryCount > 0 && onForgetMemory !== null
        ? h('button', { type: 'button', className: 'crew-link', onClick: () => { void onForgetMemory() } }, '本次不用工作区记忆')
        : null))
}
