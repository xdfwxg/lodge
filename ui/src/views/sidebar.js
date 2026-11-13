import { createElement as h } from 'react'
import { RoomMark } from '../marks.js'
import { money } from '../view-format.js'

function Sidebar({ state, onSelect, onNew }) {
  const { rooms, dispatch, activeId } = state
  const pending = dispatch?.requests?.filter(request => request.state === 'suggested').length ?? 0
  const waiting = rooms.filter(room => room.needsYou).length

  return h('aside', { className: 'dsb-side' },
    h('button', {
      type: 'button',
      className: 'crew-side-brand',
      title: '回到调度台',
      'aria-label': '回到调度台',
      onClick: () => onSelect('dispatch'),
    }, h('img', { className: 'crew-side-brand-logo', src: './logo.svg', alt: '', width: 22, height: 22 }), 'Lodge'),
    state.runtime?.ok === false
      ? h('div', { className: 'crew-error', style: { margin: '0 6px 10px' } }, `基座未连接：${state.runtime.error}`)
      : null,
    h('div', { className: 'bt-side' },
      h('div', { className: 'bt-list' },
        h('button', {
          type: 'button',
          className: 'bt-row crew-desk-row',
          'aria-current': activeId === 'dispatch' ? 'page' : undefined,
          onClick: () => onSelect('dispatch'),
        },
        h('span', { className: 'crew-desk-mark' }, '调'),
        h('span', { className: 'bt-row-body' },
          h('span', { className: 'bt-row-name' },
            h('span', { className: 'bt-row-title' }, '调度台'),
            pending > 0 ? h('span', { className: 'crew-count' }, String(pending)) : null),
          pending > 0 ? h('span', { className: 'bt-row-preview' }, '待你确认') : null)),
        h('div', { className: 'crew-section' },
          h('span', null, '房间'),
          h('span', { className: 'crew-section-tools' },
            waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个等你`) : null,
            h('button', { type: 'button', className: 'crew-new', onClick: onNew }, '＋ 新建'))),
        rooms.map(room => h(RoomRow, {
          key: room.id,
          room,
          active: activeId === room.id,
          onSelect: () => onSelect(room.id),
        })))),
    state.budget?.globalBudgetMicroUsd > 0
      ? h('div', { className: 'crew-me' },
        h('span', { className: 'crew-me-badge' }, '预'),
        h('span', { className: 'crew-me-body' },
          h('b', null, '全局预算'),
          h('small', null, `${money(state.budget.globalSpentMicroUsd)} / ${money(state.budget.globalBudgetMicroUsd)}`)))
      : null,
    h('div', { className: 'crew-me' },
      h('span', { className: 'crew-me-badge' }, '你'),
      h('span', { className: 'crew-me-body' }, h('b', null, '你'))))
}

function RoomRow({ room, active, onSelect }) {
  const needs = room.needsYou
  const stateLabel = room.live === true ? '实时' : room.state === 'complete' ? '已完成' : '进行中'
  const preview = needs ? needs.label : stateLabel
  return h('button', {
    type: 'button',
    className: 'bt-row',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
  },
  h(RoomMark, { room, size: 36 }),
  h('span', { className: 'bt-row-body' },
    h('span', { className: 'bt-row-name' },
      h('span', { className: 'bt-row-title' }, room.name),
      room.chatUnread === true && !active
        ? h('span', { className: 'crew-unread-dot', title: '聊天有新消息' })
        : null),
    h('span', { className: 'bt-row-preview', 'data-needs': needs?.kind }, preview)))
}

export { Sidebar }
