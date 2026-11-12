import { createElement as h, useMemo } from 'react'
import { RoomAvatar } from '../marks.js'
import { ImportButton } from '../import-button.js'
import { money } from '../view-format.js'

function Sidebar({ state, onSelect, onNew, onImport }) {
  const { rooms, dispatch, seats, activeId } = state
  const roster = useMemo(() => {
    const byId = Object.fromEntries(seats.map(seat => [seat.id, seat]))
    for (const room of rooms) for (const seat of room.seatSpecs ?? []) byId[seat.id] = seat
    return {
      byId,
      roomsById: Object.fromEntries(rooms.map(room => [room.id, room])),
      exchangeTurns: {},
      questions: {},
    }
  }, [seats, rooms])
  const pending = dispatch?.requests?.filter(request => request.state === 'suggested').length ?? 0
  const waiting = rooms.filter(room => room.needsYou).length

  return h('aside', { className: 'dsb-side' },
    h('div', { className: 'crew-side-brand' }, h('img', { className: 'crew-side-brand-logo', src: './logo.svg', alt: '', width: 22, height: 22 }), 'Lodge'),
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
        h('button', {
          type: 'button',
          className: 'bt-row',
          'aria-current': activeId === 'usage' ? 'page' : undefined,
          onClick: () => onSelect('usage'),
        },
        h('span', { className: 'crew-desk-mark' }, '用'),
        h('span', { className: 'bt-row-body' },
          h('span', { className: 'bt-row-name' }, h('span', { className: 'bt-row-title' }, '用量')),
          h('span', { className: 'bt-row-preview' }, '花费 · Token · 排名'))),
        h('div', { className: 'crew-section' },
          h('span', null, '房间'),
          h('span', { className: 'crew-section-tools' },
            waiting > 0 ? h('span', { className: 'crew-needs-count' }, `${waiting} 个等你`) : null,
            h(ImportButton, { className: 'crew-new', onFile: onImport }, '打开'),
            h('button', { type: 'button', className: 'crew-new', onClick: onNew }, '＋ 新建'))),
        rooms.map(room => h(RoomRow, {
          key: room.id,
          room,
          roster,
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

const ROOM_TYPE_LABEL = { roundtable: '圆桌派队', archive: '存档房' }

function RoomRow({ room, roster, active, onSelect }) {
  const needs = room.needsYou
  const typeLabel = ROOM_TYPE_LABEL[room.roomType]
  const stateLabel = room.live === true ? '实时 · 基座房间' : room.state === 'complete' ? '已完成' : '进行中'
  const preview = needs
    ? needs.label
    : room.imported === true ? '交接记录 · 只读'
      : typeLabel === undefined ? stateLabel : `${typeLabel} · ${room.state === 'complete' ? '已完成' : '进行中'}`
  return h('button', {
    type: 'button',
    className: 'bt-row',
    'aria-current': active ? 'page' : undefined,
    onClick: onSelect,
  },
  h(RoomAvatar, { room: { ...room, members: room.members ?? [] }, roster, size: 36 }),
  h('span', { className: 'bt-row-body' },
    h('span', { className: 'bt-row-name' },
      h('span', { className: 'bt-row-title' }, room.name),
      needs ? h('span', { className: 'crew-needs-dot', 'data-kind': needs.kind, title: needs.label }) : null),
    h('span', { className: 'bt-row-preview', 'data-needs': needs?.kind }, preview)))
}

export { Sidebar }
