import { createElement as h } from 'react'
import { Advanced } from './advanced.js'
import { money } from '../view-format.js'

const TABS = [
  { id: 'status', label: '状态' },
  { id: 'env', label: '环境' },
  { id: 'output', label: '交付' },
  { id: 'advanced', label: '高级' },
]

const stageTitle = room => {
  const index = (room.stages ?? []).findIndex(stage => stage.state === 'active')
  return index < 0 ? '' : room.stages[index]?.title ?? ''
}

const statusLine = room => {
  if (room.roomType === 'chat') {
    const chat = room.chat ?? {}
    return `第 ${chat.round ?? 1} 轮 · ${chat.phase ?? 'discussing'} · ${chat.turns ?? 0}/${chat.turnLimit ?? 6}`
  }
  const stage = stageTitle(room)
  return `${room.closure ?? 'open'} · ${room.state}${stage === '' ? '' : ` · ${stage}`}`
}

const seatLine = (room, seat) => {
  const engine = room.engines?.[seat.id] ?? seat.engine ?? ''
  const model = room.models?.[seat.id] ?? seat.model ?? ''
  return model === '' ? engine : `${engine} · ${model}`
}

const evidenceStats = room => {
  const messages = room.messages ?? []
  const evidence = messages.filter(message => message.kind === 'evidence' && message.meta?.kind !== 'turn').length
  const verdicts = messages.filter(message => message.kind === 'verdict')
  const last = verdicts.at(-1)
  return {
    evidence,
    verdicts: verdicts.length,
    last: last === undefined ? '' : `${last.meta?.pass === true ? 'PASS' : 'REJECT'} · ${last.authorId ?? ''}`,
  }
}

export function RoomRail({ room, seats, store, engines = [], rooms = [], tab, onTab }) {
  const stats = evidenceStats(room)
  const current = TABS.some(item => item.id === tab) ? tab : 'status'
  return h('aside', { className: 'crew-rail', 'aria-label': '房间上下文' },
    h('div', { className: 'crew-rail-tabs' },
      TABS.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'crew-rail-tab',
        'data-on': current === item.id ? 'true' : undefined,
        onClick: () => onTab(item.id),
      }, item.label))),
    current === 'status'
      ? h('div', { className: 'crew-rail-body' },
        h('section', { className: 'crew-rail-section' },
          h('b', null, '房间状态'),
          h('p', null, statusLine(room)),
          h('p', { className: 'crew-muted' }, room.roomType === 'chat' ? '聊天室只讨论，不执行交付' : `验收：${room.verifierPolicy ?? 'all'} · 影子评审：${room.shadowReview === true ? '开' : '关'}`)),
        h('section', { className: 'crew-rail-section' },
          h('b', null, '证据与结论'),
          h('p', null, `凭证 ${stats.evidence} · verdict ${stats.verdicts}`),
          h('p', { className: 'crew-muted' }, stats.last === '' ? '还没有 verdict' : `最近：${stats.last}`)),
        h('div', { className: 'crew-rail-actions' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.openReplay(room.id) }, '状态回放'),
          room.roomType === 'studio'
            ? h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.openShadow(room.id) }, room.shadowReview === true ? '影子评审' : '评审对照')
            : null,
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.openReview(room.id) }, '复盘')))
      : null,
    current === 'env'
      ? h('div', { className: 'crew-rail-body' },
        h('section', { className: 'crew-rail-section' },
          h('b', null, '席位与引擎'),
          (room.seatSpecs ?? []).map(seat => h('div', { key: seat.id, className: 'crew-rail-row' },
            h('span', null, seat.name ?? seat.id),
            h('span', { className: 'crew-muted' }, seatLine(room, seat))))),
        h('section', { className: 'crew-rail-section' },
          h('b', null, '空间'),
          h('p', { className: 'crew-rail-path', title: room.repoPath }, room.repoPath ?? '未设置'),
          h('p', { className: 'crew-muted' }, `独立性策略：${room.independencePolicy === 'require' ? 'require' : 'prefer'} · ${room.independenceLabel ?? '未标注'}`)),
        h('section', { className: 'crew-rail-section' },
          h('b', null, '预算'),
          h('p', { className: 'crew-muted' }, `已用 ${money(room.usage?.costMicroUsd ?? 0)}${room.usage?.budgetMicroUsd ? ` / ${money(room.usage.budgetMicroUsd)}` : ''}`)))
      : null,
    current === 'output'
      ? h('div', { className: 'crew-rail-body' },
        h('section', { className: 'crew-rail-section' },
          h('b', null, '交付'),
          h('p', null, room.delivery === null || room.delivery === undefined ? '还没有交付单' : '交付单已生成'),
          h('p', { className: 'crew-muted' }, room.delivery?.commit ? `commit ${room.delivery.commit.slice(0, 10)}` : '完成后可导出')),
        h('div', { className: 'crew-rail-actions' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.exportDelivery() }, '导出交付单'),
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => void store.exportHandoff() }, '导出交接包')))
      : null,
    current === 'advanced'
      ? h('div', { className: 'crew-rail-advanced' },
        h(Advanced, { room, seats, store, engines, rooms }))
      : null)
}
