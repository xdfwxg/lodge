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
      handle: typeof meta.targetHandle === 'string' ? meta.targetHandle : '',
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
      handle: '',
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
    handle: '',
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
  dispatch: '阶段开始',
  review: '复核',
  rework: '返工',
  retry: '重试',
}

const STATUS = {
  sending: '发送中',
  sent: '已唤醒',
  failed: '发送失败',
}

export function Baton({ message, room, byId }) {
  const baton = batonOf(message, room, byId)
  return h('div', {
    className: 'studio-baton',
    'data-rework': baton.rework ? 'true' : undefined,
    'data-handoff': message.kind === 'handoff' ? 'true' : undefined,
    'data-status': baton.status || undefined,
  },
    message.kind === 'handoff' ? h('span', { className: 'studio-baton-kicker' }, '工作拍') : null,
    h('span', { className: 'studio-baton-from' }, baton.from),
    h(ArrowRightIcon),
    h('span', { className: 'studio-baton-to' }, baton.to === '' ? '执行官' : baton.to),
    baton.reason === '' ? null : h('span', { className: 'studio-baton-reason' }, REASON[baton.reason] ?? baton.reason),
    baton.stage === '' ? null : h('span', { className: 'studio-baton-stage' }, `阶段 ${baton.stage}`),
    baton.scope === '' ? null : h('span', { className: 'studio-baton-scope' }, `写范围 ${baton.scope}`),
    baton.acceptance === '' ? null : h('code', null, baton.acceptance),
    baton.status === '' ? null : h('span', { className: 'studio-baton-status', 'data-status': baton.status }, STATUS[baton.status] ?? baton.status),
    h('details', { className: 'studio-baton-more' },
      h('summary', null, baton.workTurn === null ? (baton.rework ? '返工原文' : '交接原文') : '工作拍详情'),
      h('div', { className: 'studio-baton-body' },
        baton.handle === ''
          ? null
          : h('div', { className: 'studio-baton-work-row' }, h('b', null, '唤醒 handle'), h('code', null, `@${baton.handle}`)),
        baton.workTurn === null ? null : h(WorkTurnDetails, { workTurn: baton.workTurn }),
        h(Markdown, { text: baton.text, variant: 'compact' }))))
}

function WorkTurnDetails({ workTurn }) {
  const evidence = workTurn.evidence
  const verdict = workTurn.verdict
  return h('div', { className: 'studio-baton-work' },
    workTurn.done?.length > 0
      ? h('div', { className: 'studio-baton-work-row' }, h('b', null, '完成条件'), h('span', null, workTurn.done.join('；')))
      : null,
    workTurn.constraints?.length > 0
      ? h('div', { className: 'studio-baton-work-row' }, h('b', null, '约束'), h('span', null, workTurn.constraints.join('；')))
      : null,
    evidence === null || evidence === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' },
        h('b', null, '证据'),
        h('span', null,
          `${evidence.command || '人工产物'} · 退出码 ${evidence.exit === null ? '无' : evidence.exit}`,
          evidence.changedFiles?.length > 0 ? ` · ${evidence.changedFiles.join('、')}` : '')),
    verdict === null || verdict === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' },
        h('b', null, '上一轮复核'),
        h('span', { 'data-pass': verdict.pass ? 'true' : 'false' }, verdict.pass ? '通过' : '退回',
          verdict.text ? ` · ${verdict.text}` : '')),
    workTurn.candidate === null || workTurn.candidate === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' }, h('b', null, '候选提交'), h('code', null, workTurn.candidate.slice(0, 12))))
}
