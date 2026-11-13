// 影子评审只做并排展示：Verifier verdict 是正式结论，advisor 只是对照。
const advisorOf = message => {
  const advice = Array.isArray(message?.meta?.advice) ? message.meta.advice[0] : null
  if (advice === null) return null
  return {
    score: Number.isFinite(advice.score) ? advice.score : null,
    summary: typeof advice.summary === 'string' ? advice.summary : '',
    reasons: Array.isArray(advice.reasons) ? advice.reasons.slice(0, 6) : [],
    risks: Array.isArray(advice.risks) ? advice.risks.slice(0, 6) : [],
    missingEvidence: Array.isArray(advice.missingEvidence) ? advice.missingEvidence.slice(0, 6) : [],
    model: typeof message.meta.model === 'string' ? message.meta.model : '',
    shadow: message.meta.shadow === true,
  }
}

const tendencyOf = score => (
  score === null ? 'none' : score >= 0.6 ? 'pass' : score <= 0.4 ? 'reject' : 'neutral'
)

const verdictStateOf = verdicts => {
  const passes = verdicts.filter(item => item.meta?.pass === true).length
  const rejects = verdicts.length - passes
  if (verdicts.length === 0) return 'pending'
  if (passes > 0 && rejects > 0) return 'mixed'
  return passes > 0 ? 'pass' : 'reject'
}

const agreementOf = (verdictState, tendency) => {
  if (verdictState === 'pending') return 'pending'
  if (verdictState === 'mixed') return 'mixed'
  if (tendency === 'none') return 'missing'
  if (tendency === 'neutral') return 'neutral'
  return verdictState === tendency ? 'agree' : 'disagree'
}

// 只按日志和账本计算，不读 advisor 以外的上下文，也不改任何状态。
export const buildShadowComparison = ({ evidence = [], messages = [] }) => {
  const advices = messages.filter(message => message.kind === 'advisor_advice' && typeof message.meta?.evidenceId === 'string')
  const verdicts = messages.filter(message => message.kind === 'verdict' && typeof message.meta?.evidenceId === 'string')
  const rows = evidence
    .filter(item => item.meta?.kind === 'command' || item.meta?.kind === 'manual')
    .map(item => {
      const rowVerdicts = verdicts.filter(message => message.meta.evidenceId === item.id)
      const adviceMessage = [...advices].reverse().find(message => message.meta.evidenceId === item.id)
      const advice = advisorOf(adviceMessage)
      const verdictState = verdictStateOf(rowVerdicts)
      const tendency = tendencyOf(advice?.score ?? null)
      return {
        evidenceId: item.id,
        stage: item.meta?.stage ?? 0,
        kind: item.meta?.kind ?? '',
        command: typeof item.meta?.command === 'string' ? item.meta.command : '',
        exit: item.meta?.exit ?? null,
        digest: item.digest ?? '',
        at: item.at ?? null,
        verdictState,
        tendency,
        status: agreementOf(verdictState, tendency),
        verdicts: rowVerdicts.map(message => ({
          authorId: message.authorId,
          pass: message.meta?.pass === true,
          reason: typeof message.meta?.reason === 'string' ? message.meta.reason : '',
          mode: message.meta?.mode ?? 'agent',
        })),
        advice,
      }
    })
  const summary = { total: rows.length, agree: 0, disagree: 0, neutral: 0, pending: 0, mixed: 0, missing: 0 }
  for (const row of rows) summary[row.status] = (summary[row.status] ?? 0) + 1
  return { rows, summary }
}
