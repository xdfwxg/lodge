import { createElement as h, useState } from 'react'

// 影子评审只保留一份外部意见，供人签字前按需查看；没有分数，也不参与验收判定。
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
  // 只认当前这一步最新证据对应的意见；新一轮证据出来后，旧意见不再上桌。
  const evidence = [...(room?.messages ?? [])].reverse().find(item => (
    item.kind === 'evidence' &&
    (item.meta?.stage ?? 0) === stageIndex &&
    (item.meta?.kind === 'manual' || item.meta?.kind === 'command')
  ))
  if (evidence === undefined || entry.evidenceId !== evidence.id) return null
  return adviceOf(entry)
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
      ? h('p', { className: 'crew-field-hint' }, `缺失结果：${advice.missingEvidence.join('；')}`)
      : null,
    advice.model === '' ? null : h('p', { className: 'crew-field-hint' }, `来源：${advice.model}`))
}

export const needsShadowReconfirm = (room, advisor) => (
  room?.shadowReview === true &&
  (advisor?.available !== true || room.advisorConsent?.host !== advisor?.host)
)

export function ShadowReconfirm({ room, advisor, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!needsShadowReconfirm(room, advisor)) return null
  const unavailable = advisor?.available !== true
  const host = advisor?.host ?? ''
  const text = unavailable
    ? '影子评审这次接不上：没有可用的外部 advisor。'
    : `外部服务已换成 ${host}；重新确认后，这次签字才会带上影子评审。`
  return h('div', { className: 'crew-shadow-reconfirm' },
    h('p', null, text),
    unavailable ? null : h('button', {
      type: 'button',
      className: 'crew-ghost',
      disabled: busy,
      onClick: async () => {
        setBusy(true)
        const result = await onConfirm?.()
        setBusy(false)
        if (result?.ok !== true) setError(result?.error ?? '影子评审没能重新确认')
      },
    }, busy ? '正在确认…' : '重新确认影子评审'),
    error === '' ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, error),
    h('p', { className: 'crew-field-hint' }, '验收不受影响。'))
}
