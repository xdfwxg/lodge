import { Fragment, createElement as h } from 'react'
import { countOf } from '../view-format.js'

const tokenTotal = bucket => (bucket.tokens?.input ?? 0) + (bucket.tokens?.output ?? 0)

export function TokenTrend({ usage }) {
  if (usage === null || usage === undefined) return null
  const values = usage.buckets.map(tokenTotal)
  const peak = Math.max(1, ...values)
  const width = 100
  const height = 44
  const pad = 4
  const points = values.map((value, index) => [
    values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    height - pad - (value / peak) * (height - pad * 2),
  ])
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  return h('div', { className: 'crew-token-trend' },
    h('div', { className: 'crew-token-trend-head' },
      h('span', null, '最近 7 天 Token'),
      h('b', null, countOf(values.reduce((sum, value) => sum + value, 0)))),
    h('div', { className: 'crew-token-chart' },
      h('svg', {
        className: 'crew-token-line',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': '最近 7 天 Token 趋势',
      },
      h('path', { className: 'crew-token-base', d: `M0,${height - pad} L${width},${height - pad}` }),
      h('path', { className: 'crew-token-area', d: area }),
      h('path', { className: 'crew-token-path', d: line }))),
    h('div', { className: 'crew-token-axis' },
      h('span', null, usage.buckets[0]?.label ?? ''),
      h('span', null, usage.buckets.at(-1)?.label ?? '')))
}

export function ResourcePanel({ resources, usage, store }) {
  if (resources === null || resources === undefined) {
    return h('div', { className: 'crew-resource' }, h('p', { className: 'crew-muted' }, '资源面板加载中…'))
  }
  const g = resources.global
  const stats = [
    ['房间', `${g.rooms} · 活跃 ${g.active} / 暂停 ${g.paused}`],
    ['完成 / 停止', `${g.complete} / ${g.stopped}`],
    ['待你处理', countOf(g.needsYou)],
    ['失败命令', countOf(g.failedCommands)],
    ['返工', countOf(g.rework)],
    ['冲突 / 部分成功', `${g.conflicts} / ${g.partial}`],
  ]
  return h('div', { className: 'crew-resource' },
    h('div', { className: 'crew-resource-stats' },
      stats.map(([label, value]) => h('div', { key: label, className: 'crew-resource-stat' },
        h('span', null, label),
        h('b', { title: value }, value)))),
    h(TokenTrend, { usage }),
    (resources.deliveries ?? []).length > 0
      ? h(Fragment, null,
        h('div', { className: 'crew-section-title' }, '最近交付'),
        h('div', { className: 'crew-resource-rooms' },
          resources.deliveries.map(item => h('button', {
            key: item.roomId,
            type: 'button',
            className: 'crew-resource-room',
            onClick: () => store.select(item.roomId),
          },
          h('span', { className: 'crew-resource-name' }, item.name),
          h('span', { className: 'crew-resource-state', 'data-state': 'complete' }, '已完成'),
          h('span', null, `${item.stages} 阶段`),
          h('span', null, `${item.commands} 命令`),
          h('span', { className: 'crew-muted' }, `${item.changedFiles} 文件`),
          h('span', { className: 'crew-muted' }, item.commit ? item.commit.slice(0, 8) : '无 commit')))))
      : null)
}
