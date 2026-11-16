import { createElement as h } from 'react'

// 影子评审只保留一份外部意见，供人签字前按需查看；没有分数，也不参与验收判定。
const adviceOf = message => {
  const first = Array.isArray(message?.meta?.advice) ? message.meta.advice[0] : null
  if (first === null || typeof first !== 'object') return null
  return {
    summary: typeof first.summary === 'string' ? first.summary : '',
    reasons: Array.isArray(first.reasons) ? first.reasons.slice(0, 8) : [],
    risks: Array.isArray(first.risks) ? first.risks.slice(0, 8) : [],
    missingEvidence: Array.isArray(first.missingEvidence) ? first.missingEvidence.slice(0, 8) : [],
    model: typeof message.meta.model === 'string' ? message.meta.model : '',
  }
}

export const shadowAdviceFor = (room, evidenceId) => {
  if (typeof evidenceId !== 'string' || evidenceId === '') return null
  const message = [...(room?.messages ?? [])].reverse().find(item => (
    item.kind === 'advisor_advice' && item.meta?.evidenceId === evidenceId
  ))
  return message === undefined ? null : adviceOf(message)
}

export const shadowAdviceForStage = (room, stageIndex) => {
  const messages = room?.messages ?? []
  // 只认当前这一步最新证据对应的意见；新一轮证据出来后，旧意见不再上桌。
  const evidence = [...messages].reverse().find(item => (
    item.kind === 'evidence' &&
    (item.meta?.stage ?? 0) === stageIndex &&
    (item.meta?.kind === 'manual' || item.meta?.kind === 'command')
  ))
  if (evidence === undefined) return null
  const message = [...messages].reverse().find(item => (
    item.kind === 'advisor_advice' && item.meta?.evidenceId === evidence.id
  ))
  return message === undefined ? null : adviceOf(message)
}

export function ShadowAdvice({ room, evidenceId = null, stageIndex = null, label = '外部意见（仅供参考）' }) {
  const advice = stageIndex === null ? shadowAdviceFor(room, evidenceId) : shadowAdviceForStage(room, stageIndex)
  if (advice === null) return null
  return h('details', { className: 'crew-fold crew-shadow-advice' },
    h('summary', null, label),
    advice.summary === '' ? null : h('p', null, advice.summary),
    advice.reasons.length > 0
      ? h('p', { className: 'crew-field-hint' }, `理由：${advice.reasons.join('；')}`)
      : null,
    advice.risks.length > 0
      ? h('p', { className: 'crew-field-hint' }, `风险：${advice.risks.join('；')}`)
      : null,
    advice.missingEvidence.length > 0
      ? h('p', { className: 'crew-field-hint' }, `缺失证据：${advice.missingEvidence.join('；')}`)
      : null,
    advice.model === '' ? null : h('p', { className: 'crew-field-hint' }, `来源：${advice.model}`))
}
