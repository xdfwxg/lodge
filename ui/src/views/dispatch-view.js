import { Fragment, createElement as h, useEffect } from 'react'
import { Composer } from '../composer.js'
import { countOf, timeOf } from '../view-format.js'

function DispatchCard({ request, onConfirm, onDecline, onOpen }) {
  const suggestion = request.suggestion
  return h('div', { className: 'crew-req' },
    h('div', { className: 'crew-req-head' },
      h('span', { className: 'crew-req-text' }, request.text),
      h('span', { className: 'crew-req-time' }, timeOf(request.at))),
    h('div', { className: 'crew-req-body' },
      h('div', { className: 'crew-sug' },
        h('span', null, '建议交给 '),
        h('button', { type: 'button', className: 'crew-link', onClick: onOpen }, suggestion.roomName),
        h('span', null, ` · ${suggestion.seatName}`)),
      h('p', { className: 'crew-req-reason' }, suggestion.reason)),
    h('div', { className: 'crew-req-foot' },
      h('button', { type: 'button', className: 'crew-ghost', onClick: onDecline }, '驳回'),
      h('button', { type: 'button', className: 'crew-accept', onClick: onConfirm }, '确认')))
}

function DigestItem({ item, onOpen }) {
  const stateText = item.state === 'complete'
    ? '已完成'
    : item.stage
      ? `阶段 ${item.stage.index}/${item.stage.total} · ${item.stage.title}`
      : '待总结'
  return h('button', { type: 'button', className: 'crew-digest-item', onClick: onOpen },
    h('span', { className: 'crew-digest-main' },
      h('span', { className: 'crew-digest-room' }, item.roomName),
      h('span', { className: 'crew-digest-state', 'data-done': item.state === 'complete' }, stateText)),
    h('span', { className: 'crew-digest-evidence' },
      item.evidence?.command
        ? `${item.evidence.command} · ${item.evidence.exit === undefined ? '无退出码' : `exit ${item.evidence.exit}`}`
        : '暂无证据'),
    item.needsYou
      ? h('span', { className: 'crew-digest-needs', 'data-kind': item.needsYou.kind },
        item.needsYou.kind === 'question' && item.openQuestion
          ? `未决：${item.openQuestion}`
          : item.needsYou.label)
      : null)
}

const tokenTotal = bucket => (bucket.tokens?.input ?? 0) + (bucket.tokens?.output ?? 0)

function TokenTrend({ usage }) {
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

function ResourcePanel({ resources, usage, store }) {
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

function DispatchView({ state, store }) {
  const { dispatch, resources, usage } = state
  const roomSignature = state.rooms
    .map(room => `${room.id}:${room.state}:${room.usage?.costMicroUsd ?? 0}:${room.usage?.turns ?? 0}:${room.needsYou?.kind ?? ''}:${room.messages?.length ?? 0}`)
    .join('|')
  useEffect(() => {
    void store.loadResources()
    void store.loadUsage()
  }, [store, roomSignature])
  if (dispatch === null) return null
  const pending = dispatch.requests.filter(request => request.state === 'suggested')
  const decided = dispatch.requests.filter(request => request.state !== 'suggested')

  return h('main', { className: 'dsb-main' },
    h('header', { className: 'crew-head crew-desk-head' },
      h('div', { className: 'crew-title' },
        h('h1', null, '调度台'),
        h('span', { className: 'crew-badge' }, '只建议 · 你确认'))),
    h('div', { className: 'dsb-scroll crew-scroll' },
      h('div', { className: 'crew-flow' },
        pending.length > 0
          ? h(Fragment, null,
            h('div', { className: 'crew-section-title' }, `需要你确认 · ${pending.length}`),
            pending.map(request => h(DispatchCard, {
              key: request.id,
              request,
              onConfirm: () => void store.dispatchConfirm(request.id),
              onDecline: () => void store.dispatchDecline(request.id),
              onOpen: () => store.select(request.suggestion.roomId),
            })))
          : null,
        dispatch.digest.length > 0
          ? h(Fragment, null,
            h('div', { className: 'crew-section-title' }, '房间'),
            dispatch.digest.map(item => h(DigestItem, {
              key: item.roomId,
              item,
              onOpen: () => store.select(item.roomId),
            })))
          : null,
        h('details', { className: 'crew-system-status' },
          h('summary', null, h('span', null, '系统状态')),
          h(ResourcePanel, { resources, usage, store }),
          decided.length > 0
            ? h(Fragment, null,
              h('div', { className: 'crew-section-title' }, '最近处理'),
              decided.map(request => h('div', { key: request.id, className: 'crew-done-row' },
                h('span', { className: 'crew-done-text' }, request.text),
                h('span', { className: 'crew-done-target' }, request.suggestion.roomName),
                h('span', { className: 'crew-done-state', 'data-declined': request.state === 'declined' },
                  request.state === 'confirmed' ? '已派' : '已驳回'))))
            : null))),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: '把这件事交给哪个房间…',
        disabled: state.phase === 'loading',
        onSend: text => store.dispatchAsk(text),
      })))
}

export { DispatchView }
