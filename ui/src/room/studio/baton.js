import { createElement as h } from 'react'
import { ArrowRightIcon } from '../../icons.js'
import { Markdown } from '../../message-cards.js'
import { memberNameOf } from '../member-name.js'
import { dispatchSummaryOf } from './handoff.js'

const nameOf = (room, byId, id) => byId?.[id]?.name ?? memberNameOf(room, id)

const namesOf = (room, byId, ids) => ids
  .map(id => nameOf(room, byId, id))
  .filter(name => name !== '')
  .join('、')

const scopeOf = text => /写范围[^`\n]*`([^`]+)`/.exec(text)?.[1] ?? ''

export const batonOf = (message, room, byId = {}) => {
  const meta = message.meta ?? {}
  const assignment = (room?.assignments ?? []).find(item => item.id === meta.assignmentId)
  if (message.kind === 'handoff' && assignment !== undefined) {
    const brief = assignment.brief ?? {}
    const messages = room?.messages ?? []
    const messagesOf = ids => (ids ?? []).map(id => messages.find(item => item.id === id)).filter(Boolean)
    const evidence = messagesOf(assignment.evidenceIds).at(-1)
      ?? (assignment.context?.evidenceId === undefined ? undefined : messages.find(item => item.id === assignment.context.evidenceId))
    const verdict = messagesOf(assignment.verdictIds).at(-1)
    return {
      from: nameOf(room, byId, assignment.fromMemberId),
      to: nameOf(room, byId, assignment.toMemberId),
      status: typeof assignment.status === 'string' ? assignment.status : '',
      reason: typeof assignment.reason === 'string' ? assignment.reason : '',
      stage: Number.isInteger(assignment.stageIndex) ? String(assignment.stageIndex + 1) : '',
      acceptance: typeof brief.acceptance === 'string' ? brief.acceptance : '',
      scope: '',
      rework: assignment.reason === 'rework',
      brief: {
        done: Array.isArray(brief.done) ? brief.done : [],
        constraints: Array.isArray(brief.constraints) ? brief.constraints : [],
        evidence: evidence === undefined ? null : {
          exit: evidence.meta?.exit ?? null,
          changedFiles: Array.isArray(evidence.meta?.changedFiles) ? evidence.meta.changedFiles : [],
        },
        verdict: verdict === undefined ? null : {
          pass: verdict.meta?.pass === true,
          text: String(verdict.text ?? ''),
        },
      },
      text: String(message.text ?? ''),
    }
  }
  if (message.kind === 'handoff') {
    // 只保留了交接引用，历史记录已归档：不假装还知道接收人和验收内容。
    return {
      from: nameOf(room, byId, message.authorId),
      to: '记录已归档',
      status: typeof meta.status === 'string' ? meta.status : '',
      reason: '',
      stage: Number.isInteger(meta.stage) ? String(meta.stage + 1) : '',
      acceptance: '',
      scope: '',
      rework: false,
      brief: null,
      archived: true,
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
      brief: null,
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
    brief: null,
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
  created: '正在送达',
  sending: '正在送达',
  sent: '已送达',
  working: '在做',
  reported: '已交结果',
  reviewing: '复核中',
  passed: '通过',
  rejected: '退回',
  failed: '没能送达',
  cancelled: '已取消',
}

export function Baton({ message, room, byId }) {
  const baton = batonOf(message, room, byId)
  return h('div', {
    className: 'studio-baton',
    'data-rework': baton.rework ? 'true' : undefined,
    'data-handoff': message.kind === 'handoff' ? 'true' : undefined,
    'data-status': baton.status || undefined,
  },
    message.kind === 'handoff' ? h('span', { className: 'studio-baton-kicker' }, baton.archived ? '交接 · 已归档' : '交接') : null,
    h('span', { className: 'studio-baton-from' }, baton.from),
    h(ArrowRightIcon),
    h('span', { className: 'studio-baton-to' }, baton.to === '' ? '执行官' : baton.to),
    baton.archived ? null : baton.reason === '' ? null : h('span', { className: 'studio-baton-reason' }, REASON[baton.reason] ?? baton.reason),
    baton.stage === '' ? null : h('span', { className: 'studio-baton-stage' }, `第 ${baton.stage} 步`),
    baton.archived ? null : baton.acceptance === '' ? null : h('span', null, '验收：', h('code', null, baton.acceptance)),
    baton.status === '' ? null : h('span', { className: 'studio-baton-status', 'data-status': baton.status }, STATUS[baton.status] ?? baton.status),
    h('details', { className: 'studio-baton-more' },
      h('summary', null, baton.brief === null ? (baton.rework ? '重做说明' : '交接说明') : '交接详情'),
      h('div', { className: 'studio-baton-body' },
        baton.brief === null ? null : h(BriefDetails, { brief: baton.brief }),
        h(Markdown, { text: baton.text, variant: 'compact' }))))
}

function BriefDetails({ brief }) {
  return h('div', { className: 'studio-baton-work' },
    brief.done?.length > 0
      ? h('div', { className: 'studio-baton-work-row' }, h('b', null, '要做成什么'), h('span', null, brief.done.join('；')))
      : null,
    brief.constraints?.length > 0
      ? h('div', { className: 'studio-baton-work-row' }, h('b', null, '限制'), h('span', null, brief.constraints.join('；')))
      : null,
    brief.evidence === null || brief.evidence === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' },
        h('b', null, '检查结果'),
        h('span', { 'data-pass': brief.evidence.exit === 0 ? 'true' : 'false' }, brief.evidence.exit === 0 ? '通过' : '没通过',
          brief.evidence.changedFiles?.length > 0 ? ` · ${brief.evidence.changedFiles.join('、')}` : '')),
    brief.verdict === null || brief.verdict === undefined
      ? null
      : h('div', { className: 'studio-baton-work-row' },
        h('b', null, '验收意见'),
        h('span', { 'data-pass': brief.verdict.pass ? 'true' : 'false' }, brief.verdict.pass ? '通过' : '退回',
          brief.verdict.text ? ` · ${brief.verdict.text}` : '')))
}
