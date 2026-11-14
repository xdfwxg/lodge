// 影子评审只做并排对照：验收员的 verdict 决定流转，advisor 建议只记录。
const tendencyOf = score => (
  Number.isFinite(score) ? (score >= 0.6 ? 'pass' : score <= 0.4 ? 'reject' : 'neutral') : 'none'
)

const verdictStateOf = verdicts => {
  const passes = verdicts.filter(item => item.meta?.pass === true).length
  if (verdicts.length === 0) return 'pending'
  if (passes > 0 && passes < verdicts.length) return 'mixed'
  return passes > 0 ? 'pass' : 'reject'
}

const agreementOf = (verdictState, tendency) => {
  if (verdictState === 'pending') return 'pending'
  if (verdictState === 'mixed') return 'mixed'
  if (tendency === 'none') return 'missing'
  if (tendency === 'neutral') return 'neutral'
  return verdictState === tendency ? 'agree' : 'disagree'
}

const adviceOf = message => {
  const advice = Array.isArray(message?.meta?.advice) ? message.meta.advice[0] : null
  if (advice === null || typeof advice !== 'object') return null
  return {
    score: Number.isFinite(advice.score) ? advice.score : null,
    summary: typeof advice.summary === 'string' ? advice.summary : '',
    reasons: Array.isArray(advice.reasons) ? advice.reasons.slice(0, 4) : [],
    risks: Array.isArray(advice.risks) ? advice.risks.slice(0, 4) : [],
    model: typeof message.meta.model === 'string' ? message.meta.model : '',
    shadow: message.meta.shadow === true,
  }
}

export const shadowFor = (room, message) => {
  if (message?.kind !== 'verdict') return null
  const evidenceId = message.meta?.evidenceId
  if (typeof evidenceId !== 'string' || evidenceId === '') return null
  const messages = Array.isArray(room?.messages) ? room.messages : []
  const verdicts = messages.filter(item => item.kind === 'verdict' && item.meta?.evidenceId === evidenceId)
  if (verdicts.at(-1)?.id !== message.id) return null
  const adviceMessage = [...messages].reverse().find(item => (
    item.kind === 'advisor_advice' && item.meta?.evidenceId === evidenceId
  ))
  if (adviceMessage === undefined) return null
  const advice = adviceOf(adviceMessage)
  if (advice === null) return null
  const verdictState = verdictStateOf(verdicts)
  const tendency = tendencyOf(advice.score)
  return {
    evidenceId,
    stage: Number.isInteger(message.meta?.stage) ? message.meta.stage : 0,
    advice,
    verdicts: verdicts.map(item => ({
      id: item.id,
      authorId: item.authorId,
      pass: item.meta?.pass === true,
      text: typeof item.text === 'string' ? item.text : '',
    })),
    verdictState,
    tendency,
    status: agreementOf(verdictState, tendency),
  }
}
