import { createElement as h } from 'react'
import { ArrowRightIcon } from '../../icons.js'
import { Markdown } from '../../message-cards.js'
import { seatNameOf } from '../seat-name.js'
import { dispatchSummaryOf } from './handoff.js'

const nameOf = (room, byId, id) => byId?.[id]?.name ?? seatNameOf(room, id)

const namesOf = (room, byId, ids) => ids
  .map(id => nameOf(room, byId, id))
  .filter(name => name !== '')
  .join('、')

export const batonOf = (message, room, byId = {}) => {
  const meta = message.meta ?? {}
  if (message.kind === 'dispatch') {
    return {
      from: nameOf(room, byId, message.authorId),
      to: namesOf(room, byId, Array.isArray(meta.workers) ? meta.workers : []),
      stage: Number.isInteger(meta.stage) ? String(meta.stage + 1) : '',
      acceptance: typeof meta.acceptance === 'string' ? meta.acceptance : '',
      rework: meta.rework === true,
      text: String(message.text ?? ''),
    }
  }
  const summary = dispatchSummaryOf(message)
  return {
    from: nameOf(room, byId, message.authorId),
    to: summary.mention,
    stage: summary.stage,
    acceptance: summary.acceptance,
    rework: false,
    text: String(message.text ?? ''),
  }
}

// 派活不是一张工单，而是一次接力：谁交给谁、第几阶段、验收什么。
export function Baton({ message, room, byId }) {
  const baton = batonOf(message, room, byId)
  return h('div', { className: 'studio-baton', 'data-rework': baton.rework ? 'true' : undefined },
    h('span', { className: 'studio-baton-from' }, baton.from),
    h(ArrowRightIcon),
    h('span', { className: 'studio-baton-to' }, baton.to === '' ? '执行官' : baton.to),
    baton.stage === '' ? null : h('span', { className: 'studio-baton-stage' }, `阶段 ${baton.stage}`),
    baton.acceptance === '' ? null : h('code', null, baton.acceptance),
    h('details', { className: 'studio-baton-more' },
      h('summary', null, baton.rework ? '返工原文' : '派活原文'),
      h('div', { className: 'studio-baton-body' },
        h(Markdown, { text: baton.text, variant: 'compact' }))))
}
