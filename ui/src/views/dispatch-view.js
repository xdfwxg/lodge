import { Fragment, createElement as h, useEffect } from 'react'
import { Composer } from '../composer.js'
import { timeOf } from '../view-format.js'
import { ResourcePanel } from './dispatch-status.js'

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
