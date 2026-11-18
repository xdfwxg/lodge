import { createElement as h } from 'react'

// 影子评审只保留一份对照意见，供人签字前按需查看；没有分数，也不参与验收判定。
const adviceOf = entry => {
  const first = Array.isArray(entry?.advice) ? entry.advice[0] : null
  if (first === null || typeof first !== 'object') return null
  return {
    evidenceId: typeof entry.evidenceId === 'string' ? entry.evidenceId : null,
    summary: typeof first.summary === 'string' ? first.summary : '',
    reasons: Array.isArray(first.reasons) ? first.reasons.slice(0, 8) : [],
    risks: Array.isArray(first.risks) ? first.risks.slice(0, 8) : [],
    missingEvidence: Array.isArray(first.missingEvidence) ? first.missingEvidence.slice(0, 8) : [],
    model: typeof entry.model === 'string' ? entry.model : '',
  }
}

export const shadowAdviceFor = (room, evidenceId) => {
  if (typeof evidenceId !== 'string' || evidenceId === '') return null
  const entry = Object.values(room?.advisorShadow ?? {}).find(item => item?.evidenceId === evidenceId)
  return entry === undefined ? null : adviceOf(entry)
}

export const shadowAdviceForStage = (room, stageIndex) => {
  const entry = room?.advisorShadow?.[stageIndex]
  if (entry === undefined) return null
  // 进行中的阶段只认最新证据对应的意见；已经通过的阶段保留最后一份意见。
  if (room?.stages?.[stageIndex]?.state === 'active') {
    const evidence = [...(room?.messages ?? [])].reverse().find(item => (
      item.kind === 'evidence' &&
      (item.meta?.stage ?? 0) === stageIndex &&
      (item.meta?.kind === 'manual' || item.meta?.kind === 'command')
    ))
    if (evidence === undefined || entry.evidenceId !== evidence.id) return null
  }
  return adviceOf(entry)
}

export function ShadowAdvice({ room, evidenceId = null, stageIndex = null, label = '影子评审（仅供参考）' }) {
  const advice = stageIndex === null ? shadowAdviceFor(room, evidenceId) : shadowAdviceForStage(room, stageIndex)
  if (advice === null) return null
  const head = advice.summary === ''
    ? `${label}`
    : `影子评审：${advice.summary}（仅供参考）`
  return h('details', { className: 'crew-fold crew-shadow-advice' },
    h('summary', null, head),
    advice.reasons.length > 0
      ? h('p', { className: 'crew-field-hint' }, `理由：${advice.reasons.join('；')}`)
      : null,
    advice.risks.length > 0
      ? h('p', { className: 'crew-field-hint' }, `风险：${advice.risks.join('；')}`)
      : null,
    advice.missingEvidence.length > 0
      ? h('p', { className: 'crew-field-hint' }, `缺失结果：${advice.missingEvidence.join('；')}`)
      : null,
    advice.model === '' ? null : h('p', { className: 'crew-field-hint' }, `来源：${advice.model}`))
}
