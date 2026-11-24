import { createElement as h, useEffect, useState } from 'react'
import { timeOf } from '../../view-format.js'
import { runMetricsOf, toolLabelOf } from '../run-metrics.js'

const KIND_LABEL = { read: '读', write: '写', exec: '跑', gate: '判' }

const elapsedOf = (from, now) => {
  if (!Number.isFinite(from)) return ''
  const seconds = Math.max(0, Math.floor((now - from) / 1000))
  if (seconds < 3) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

const uniqueTargetsOf = (activities, action) => new Set(
  activities
    .filter(activity => activity.meta?.action === action)
    .map(activity => String(activity.meta?.target ?? '').trim())
    .filter(Boolean),
)

const diffStatOf = diff => {
  let add = 0
  let del = 0
  for (const line of String(diff ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add += 1
    if (line.startsWith('-') && !line.startsWith('---')) del += 1
  }
  return { add, del }
}

// 一次工具调用不是一条发言；连着的几次调用收成时间线里的一行，收起时也能看到刚做了什么。
// 折起来是“执行官 · 跑了 5 条命令，改了 3 个文件 +22 −4”，展开才是每一步。
export function ProcessGroup({ room, activities, member, isLatest = false, onForgetMemory = null }) {
  const metricsOf = isLatest ? runMetricsOf(room) : null
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
  const commands = activities.filter(activity => activity.meta?.action === 'exec').length
  const writes = uniqueTargetsOf(activities, 'write').size || activities.filter(activity => activity.meta?.action === 'write').length
  const reads = uniqueTargetsOf(activities, 'read').size || activities.filter(activity => activity.meta?.action === 'read').length
  const gates = activities.filter(activity => activity.meta?.action === 'gate').length
  const allMessages = Array.isArray(room?.messages) ? room.messages : []
  const lastIndex = allMessages.findIndex(message => message.id === last?.id)
  const evidence = lastIndex < 0
    ? null
    : allMessages.slice(lastIndex + 1).find(message => (
      message.kind === 'evidence' &&
      message.authorId === member?.id &&
      typeof message.meta?.diff === 'string'
    ))
  const diff = evidence === null || evidence === undefined ? { add: 0, del: 0 } : diffStatOf(evidence.meta.diff)
  const parts = []
  if (commands > 0) parts.push(`跑了 ${commands} 条命令`)
  if (writes > 0) parts.push(`改了 ${writes} 个文件`)
  if (commands === 0 && writes === 0 && reads > 0) parts.push(`读了 ${reads} 个文件`)
  if (commands === 0 && writes === 0 && reads === 0 && gates > 0) parts.push(`提交了 ${gates} 次判定`)
  const what = parts.length > 0
    ? parts.join('，')
    : labels.length === 1 ? labels[0] : `${labels.length} 次操作 · ${labels[labels.length - 1]}`
  const elapsed = live ? elapsedOf(last?.ts, now) : ''
  const metrics = isLatest && metricsOf !== null
    ? [
      metricsOf.usage,
      metricsOf.reworks > 0 ? `重做 ${metricsOf.reworks} 次` : '',
      metricsOf.human > 0 ? `你介入 ${metricsOf.human} 次` : '',
      metricsOf.memoryCount > 0 ? `参考 ${metricsOf.memoryCount} 条记忆` : '',
    ].filter(Boolean).join(' · ')
    : ''
  return h('details', { className: 'crew-fold crew-process' },
    h('summary', null,
      live ? h('span', { className: 'crew-process-live', 'aria-hidden': true }) : null,
      h('span', { className: 'crew-process-summary' },
        member?.name ?? '成员',
        ` · ${what}`,
        diff.add > 0 || diff.del > 0
          ? h('span', { className: 'crew-process-diff' },
            diff.add > 0 ? h('span', { className: 'crew-process-diff-add' }, `+${diff.add}`) : null,
            diff.del > 0 ? h('span', { className: 'crew-process-diff-del' }, `−${diff.del}`) : null)
          : null,
        elapsed === '' ? null : ` · ${elapsed}`),
      h('span', { className: 'crew-process-chevron', 'aria-hidden': 'true' }, '›')),
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
      metricsOf !== null && metricsOf.memoryCount > 0 && onForgetMemory !== null
        ? h('button', { type: 'button', className: 'crew-link', onClick: () => { void onForgetMemory() } }, '本次不用工作区记忆')
        : null))
}
