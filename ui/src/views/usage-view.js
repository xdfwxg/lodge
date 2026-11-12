import { Fragment, createElement as h, useEffect, useState } from 'react'
import { money, countOf } from '../view-format.js'

const USAGE_RANGES = [['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['12w', '12 周'], ['12m', '12 月']]

function UsageView({ state, store }) {
  const [range, setRange] = useState('7d')
  useEffect(() => {
    void store.loadUsage(range)
  }, [store, range])
  const usage = state.usage
  const totals = usage?.totals
  const tokens = totals === undefined ? 0 : totals.tokens.input + totals.tokens.output
  const cacheBase = totals === undefined ? 0 : totals.tokens.input + totals.tokens.cachedInput
  const cacheRate = cacheBase === 0 ? 0 : Math.round((totals.tokens.cachedInput / cacheBase) * 100)
  const peak = usage === undefined || usage === null ? 1 : Math.max(1, ...usage.buckets.map(bucket => bucket.costMicroUsd))
  const stats = usage === null || usage === undefined
    ? []
    : [
        ['花费', usage.budgetMicroUsd > 0 ? `${money(totals.costMicroUsd)} / ${money(usage.budgetMicroUsd)}` : money(totals.costMicroUsd)],
        ['Token', countOf(tokens)],
        ['缓存命中', `${cacheRate}%`],
        ['回合', countOf(totals.turns)],
        ['房间', countOf(usage.rooms.filter(room => room.costMicroUsd > 0).length)],
      ]
  return h('main', { className: 'dsb-main' },
    h('header', { className: 'crew-head crew-desk-head' },
      h('div', { className: 'crew-title' },
        h('h1', null, '用量'),
        h('span', { className: 'crew-badge' }, '只读 · 基座估算'))),
    h('div', { className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' },
        h('div', { className: 'crew-usage-tabs' },
          USAGE_RANGES.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            className: 'crew-choice',
            'data-on': range === id ? 'true' : undefined,
            onClick: () => setRange(id),
          }, label))),
        usage === null || usage === undefined
          ? h('p', { className: 'crew-muted' }, '用量账本加载中…')
          : h(Fragment, null,
            h('div', { className: 'crew-usage-stats' },
              stats.map(([label, value]) => h('div', { key: label, className: 'crew-usage-stat' },
                h('span', null, label),
                h('b', { title: value }, value)))),
            h('div', { className: 'crew-usage-chart' },
              h('div', { className: 'crew-usage-bars' },
                usage.buckets.map(bucket => h('div', { key: bucket.key, className: 'crew-usage-column', title: `${bucket.label} · ${money(bucket.costMicroUsd)} · ${bucket.turns} 回合` },
                  h('i', { style: { height: `${Math.max(3, Math.round((bucket.costMicroUsd / peak) * 100))}%` } })))),
              h('div', { className: 'crew-usage-axis' },
                h('span', null, usage.buckets[0]?.label ?? ''),
                h('span', null, usage.buckets.at(-1)?.label ?? ''))),
            h('div', { className: 'crew-section-title' }, '房间排名'),
            usage.rooms.length === 0
              ? h('p', { className: 'crew-muted' }, '这个区间没有用量。')
              : h('div', { className: 'crew-usage-rooms' },
                usage.rooms.map(room => h('button', {
                  key: room.roomId,
                  type: 'button',
                  className: 'crew-usage-room',
                  onClick: () => store.select(room.roomId),
                },
                h('span', { className: 'crew-resource-name' }, room.name),
                h('span', null, money(room.costMicroUsd)),
                h('span', null, `${countOf(room.turns)} 回合`),
                h('span', { className: 'crew-muted' }, `${countOf(room.tokens.input + room.tokens.output)} Token`)))),
            h('p', { className: 'crew-resource-note' },
              '成本与 Token 来自基座上报的估算，不是账单；导入的交接记录不计入当前用量。')))))
}

export { UsageView }
