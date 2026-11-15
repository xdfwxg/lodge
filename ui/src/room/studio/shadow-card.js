import { createElement as h } from 'react'
import { seatNameOf } from '../seat-name.js'
import { shadowFor } from './shadow-model.js'

const STATUS = {
  agree: { label: '一致', tone: 'pass' },
  disagree: { label: '分歧', tone: 'reject' },
  neutral: { label: '中性', tone: 'pending' },
  pending: { label: '待定', tone: 'pending' },
  mixed: { label: '多票不一', tone: 'pending' },
  missing: { label: '无建议', tone: 'pending' },
}

export function ShadowCard({ room, message, byId = {} }) {
  const shadow = shadowFor(room, message)
  if (shadow === null) return null
  const status = STATUS[shadow.status] ?? STATUS.pending
  const nameOf = id => byId?.[id]?.name ?? seatNameOf(room, id)
  return h('div', { className: 'crew-card crew-shadow-card', 'data-status': shadow.status },
    h('div', { className: 'crew-card-head' },
      shadow.advice.shadow ? '影子评审' : '评估建议',
      h('span', { className: 'crew-verdict', 'data-tone': status.tone }, status.label)),
    h('div', { className: 'crew-card-body' },
      h('div', { className: 'crew-shadow-cols' },
        h('div', { className: 'crew-shadow-col' },
          h('div', { className: 'crew-shadow-col-head' }, '验收员 · 正式'),
          shadow.verdicts.map(verdict => h('div', { key: verdict.id, className: 'crew-shadow-verdict' },
            h('b', { 'data-pass': verdict.pass ? 'true' : 'false' }, verdict.pass ? '通过' : '退回'),
            h('span', null, nameOf(verdict.authorId))))),
        h('div', { className: 'crew-shadow-col' },
          h('div', { className: 'crew-shadow-col-head' }, '顾问 · 仅对照'),
          h('div', { className: 'crew-shadow-score' },
            h('b', null, shadow.advice.score === null ? '无分数' : shadow.advice.score.toFixed(2)),
            shadow.advice.model === '' ? null : h('span', null, shadow.advice.model)),
          shadow.advice.summary === '' ? null : h('p', null, shadow.advice.summary),
          shadow.advice.reasons.length === 0 ? null : h('p', { className: 'crew-field-hint' }, `理由：${shadow.advice.reasons.join('；')}`),
          shadow.advice.risks.length === 0 ? null : h('p', { className: 'crew-field-hint' }, `风险：${shadow.advice.risks.join('；')}`))),
      h('p', { className: 'crew-field-hint' }, shadow.advice.shadow
        ? '暂时仅记录评估建议；流转以验收员结论为准。'
        : '建议已作为参考注入验收员，但判定仍以验收员结论为准。')))
}
