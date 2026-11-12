import { Fragment, createElement as h, useEffect } from 'react'
import { ImportButton } from '../import-button.js'
import { Composer } from '../composer.js'
import { money, countOf, timeOf } from '../view-format.js'

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

const ROOM_STATE_LABEL = { active: '进行中', paused: '已暂停', stopped: '已停止', complete: '已完成' }

function ResourcePanel({ resources, usage, store, importedDeliveries = [] }) {
  if (resources === null || resources === undefined) {
    return h('div', { className: 'crew-resource' }, h('p', { className: 'crew-muted' }, '资源面板加载中…'))
  }
  const g = resources.global
  const stats = [
    ['花费', g.budgetMicroUsd > 0 ? `${money(g.costMicroUsd)} / ${money(g.budgetMicroUsd)}` : `${money(g.costMicroUsd)} / 不限`],
    ['房间', `${g.rooms} · 活跃 ${g.active} / 暂停 ${g.paused}`],
    ['完成 / 停止', `${g.complete} / ${g.stopped}`],
    ['待你处理', countOf(g.needsYou)],
    ['失败命令', countOf(g.failedCommands)],
    ['返工', countOf(g.rework)],
    ['冲突 / 部分成功', `${g.conflicts} / ${g.partial}`],
    ['回合', countOf(g.turns)],
  ]
  return h('div', { className: 'crew-resource' },
    h('div', { className: 'crew-resource-head' },
      h('b', null, '资源'),
      h('span', { className: 'crew-muted' }, '只读 · 不路由、不执行'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.exportDeliveries() }, '导出交付'),
      h(ImportButton, { onFile: file => void store.importDeliveriesFile(file) }, '导入交付'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.loadResources() }, '刷新')),
    h('div', { className: 'crew-resource-stats' },
      stats.map(([label, value]) => h('div', { key: label, className: 'crew-resource-stat' },
        h('span', null, label),
        h('b', { title: value }, value)))),
    usage !== null && usage !== undefined
      ? h('div', { className: 'crew-usage-trend' },
        h('div', { className: 'crew-usage-bars' },
          usage.buckets.map(bucket => h('i', {
            key: bucket.day,
            style: { height: `${Math.max(4, Math.round((bucket.costMicroUsd / Math.max(1, ...usage.buckets.map(item => item.costMicroUsd))) * 100))}%` },
            title: `${bucket.day} · ${money(bucket.costMicroUsd)} · ${bucket.turns} 回合`,
          }))),
        h('span', { className: 'crew-muted' },
          `${usage.range} · Tokens ${countOf(usage.totals.tokens.input + usage.totals.tokens.output)}`))
      : null,
    h('div', { className: 'crew-resource-rooms' },
      resources.rooms.map(item => h('button', {
        key: item.roomId,
        type: 'button',
        className: 'crew-resource-room',
        onClick: () => store.select(item.roomId),
      },
      h('span', { className: 'crew-resource-name' }, item.name),
      h('span', { className: 'crew-resource-state', 'data-state': item.state }, ROOM_STATE_LABEL[item.state] ?? item.state),
      h('span', null, money(item.costMicroUsd)),
      h('span', null, `${countOf(item.turns)} 回合`),
      h('span', { className: 'crew-muted' }, item.needsYou?.label ?? ''),
      h('span', { className: 'crew-muted' },
        [item.rework > 0 ? `返工 ${item.rework}` : '', item.failedCommands > 0 ? `失败 ${item.failedCommands}` : ''].filter(Boolean).join(' · '))))),
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
      : null,
    importedDeliveries.length > 0
      ? h(Fragment, null,
        h('div', { className: 'crew-section-title' }, '导入的交付'),
        h('div', { className: 'crew-resource-rooms' },
          importedDeliveries.slice(0, 10).map(item => h('div', {
            key: `${item.roomId}-${item.commit ?? item.completedAt ?? ''}`,
            className: 'crew-resource-room',
          },
          h('span', { className: 'crew-resource-name' }, item.name),
          h('span', { className: 'crew-resource-state', 'data-state': 'complete' }, '导入'),
          h('span', null, `${item.stages} 阶段`),
          h('span', null, `${item.commands} 命令`),
          h('span', { className: 'crew-muted' }, item.commit ? item.commit.slice(0, 8) : '无 commit')))))
      : null,
    h('p', { className: 'crew-resource-note' }, '成本是基座上报的估算，不是账单。'))
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
        h(ResourcePanel, { resources, usage, store, importedDeliveries: state.importedDeliveries ?? [] }),
        h('div', { className: 'crew-section-title' }, `待你确认 · ${pending.length}`),
        pending.length === 0
          ? h('p', { className: 'crew-muted' }, '没有新的请求。')
          : pending.map(request => h(DispatchCard, {
            key: request.id,
            request,
            onConfirm: () => void store.dispatchConfirm(request.id),
            onDecline: () => void store.dispatchDecline(request.id),
            onOpen: () => store.select(request.suggestion.roomId),
          })),
        h('div', { className: 'crew-section-title' }, '已处理'),
        decided.length === 0
          ? h('p', { className: 'crew-muted' }, '还没有处理过的请求。')
          : decided.map(request => h('div', { key: request.id, className: 'crew-done-row' },
            h('span', { className: 'crew-done-text' }, request.text),
            h('span', { className: 'crew-done-target' }, request.suggestion.roomName),
            h('span', { className: 'crew-done-state', 'data-declined': request.state === 'declined' },
              request.state === 'confirmed' ? '已派' : '已驳回'))),
        h('div', { className: 'crew-section-title' }, '汇总'),
        dispatch.digest.map(item => h(DigestItem, {
          key: item.roomId,
          item,
          onOpen: () => store.select(item.roomId),
        })))),
    h('div', { className: 'dsb-composer' },
      h(Composer, {
        placeholder: '说说你想做什么，我建议交给哪个群…',
        disabled: state.phase === 'loading',
        onSend: text => store.dispatchAsk(text),
      })))
}

export { DispatchView }
