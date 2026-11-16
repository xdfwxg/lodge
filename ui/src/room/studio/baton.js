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

const scopeOf = text => /写范围[^`\n]*`([^`]+)`/.exec(text)?.[1] ?? ''

export const batonOf = (message, room, byId = {}) => {
  const meta = message.meta ?? {}
  if (message.kind === 'handoff') {
    return {
      from: nameOf(room, byId, meta.from ?? message.authorId),
      to: namesOf(room, byId, Array.isArray(meta.workers) ? meta.workers : (meta.to ? [meta.to] : [])),
      status: typeof meta.status === 'string' ? meta.status : '',
      reason: typeof meta.reason === 'string' ? meta.reason : '',
      stage: Number.isInteger(meta.stage) ? String(meta.stage + 1) : '',
      acceptance: typeof meta.acceptance === 'string' ? meta.acceptance : '',
      scope: '',
      rework: meta.rework === true,
      workTurn: meta.workTurn !== null && typeof meta.workTurn === 'object' ? meta.workTurn : null,
      text: String(message.text ?? ''),
    }
  }
  if (message.kind === 'dispatch') {
    return {
      from: nameOf(room, byId, message.authorId),
      to: namesOf(room, byId, Array.isArray(meta.workers) ? meta.workers : []),
      status: '',
      reason: 'dispatch',
      stage: Number.isInteger(meta.stage) ? String(meta.stage + 1) : '',
      acceptance: typeof meta.acceptance === 'string' ? meta.acceptance : '',
      scope: scopeOf(String(message.text ?? '')),
      rework: meta.rework === true,
      workTurn: null,
      text: String(message.text ?? ''),
    }
  }
  const summary = dispatchSummaryOf(message)
  return {
    from: nameOf(room, byId, message.authorId),
    to: summary.mention,
    status: '',
    reason: 'dispatch',
    stage: summary.stage,
    acceptance: summary.acceptance,
    scope: scopeOf(String(message.text ?? '')),
    rework: false,
    workTurn: null,
    text: String(message.text ?? ''),
  }
}

// 派活不是一张工单，而是一次接力：谁交给谁、第几阶段、验收什么。
const REASON = {
  dispatch: '开始这一步',
  review: '复核',
  rework: '重做',
  retry: '重试',
}

const STATUS = {
  sending: '正在送达',
  sent: '已送达',
  failed: '没能送达',
}

export function Baton({ message, room, byId }) {
  const baton = batonOf(message, room, byId)
  return h('div', {
    className: 'studio-baton',
    'data-rework': baton.rework ? 'true' : undefined,
    'data-handoff': message.kind === 'handoff' ? 'true' : undefined,
    'data-status': baton.status || undefined,
  },
    message.kind === 'handoff' ? h('span', { className: 'studio-baton-kicker' }, '交接') : null,
    h('span', { className: 'studio-baton-from' }, baton.from),
    h(ArrowRightIcon),
    h('span', { className: 'studio-baton-to' }, baton.to === '' ? '执行官' : baton.to),
    baton.reason === '' ? null : h('span', { className: 'studio-baton-reason' }, REASON[baton.reason] ?? baton.reason),
    baton.stage === '' ? null : h('span', { className: 'studio-baton-stage' }, `第 ${baton.stage} 步`),
    baton.acceptance === '' ? null : h('span', null, '验收：', h('code', null, baton.acceptance)),
    baton.status === '' ? null : h('span', { className: 'studio-baton-status', 'data-status': baton.status }, STATUS[baton.status] ?? baton.status),
    h('details', { className: 'studio-baton-more' },
      h('summary', null, baton.workTurn === null ? (baton.rework ? '重做说明' : '交接说明') : '交接详情'),
      h('div', { className: 'studio-baton-body' },
        baton.workTurn === null ? null : h(WorkTurnDetails, { workTurn: baton.workTurn }),
        h(Markdown, { text: baton.text, variant: 'compact' }))))
}

function WorkTurnDetails({ workTurn }) {
  const evidence = workTurn.evidence
  const verdict = workTurn.verdict
  return h('div', { className: 'studio-baton-work' },
    workTurn.done?.length > 0
      ? h('div', { className: 'studio-baton-work-row' }, h('b', null, '要做成什么'), h('span', null, workTurn.done.join('；')))
      : null,
    workTurn.constraints?.length > 0
      ? h('div', { className: 'studio-baton-work-row' }, h('b', null, '限制'), h('span', null, workTurn.constraints.join('；')))
      : null,
    evidence === null || evidence === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' },
        h('b', null, '检查结果'),
        h('span', { 'data-pass': evidence.exit === 0 ? 'true' : 'false' }, evidence.exit === 0 ? '通过' : '没通过',
          evidence.changedFiles?.length > 0 ? ` · ${evidence.changedFiles.join('、')}` : '')),
    verdict === null || verdict === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' },
        h('b', null, '上次检查'),
        h('span', { 'data-pass': verdict.pass ? 'true' : 'false' }, verdict.pass ? '通过' : '退回',
          verdict.text ? ` · ${verdict.text}` : '')))
}
