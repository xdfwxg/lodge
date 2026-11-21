// 用量只记事实：能拿到的费用是 reported，拿不到就是 unknown；混合后是 partial（至少这么多）。
export const USAGE_VERSION = 1

const microOf = value => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000_000)
    : null
)

export const emptyUsage = () => ({
  version: USAGE_VERSION,
  turns: 0,
  tokens: { input: 0, output: 0 },
  costMicroUsd: 0,
  costStatus: 'reported',
})

export const usageBudgetExceeded = room => {
  const budget = Number(room?.budgetMicroUsd)
  if (!Number.isFinite(budget) || budget <= 0) return false
  if (room?.usage?.costStatus === 'unknown') return false
  return (Number(room?.usage?.costMicroUsd) || 0) >= budget
}

export const addTurnUsage = (current, usage) => {
  if (usage === null || typeof usage !== 'object') return null
  const prior = current ?? null
  const cost = microOf(usage.costUsd)
  const known = cost !== null
  const priorUnknown = prior?.costStatus === 'unknown' || prior?.costStatus === 'partial'
  const priorKnown = prior !== null && ((prior?.costMicroUsd ?? 0) > 0 || prior?.costStatus === 'reported')
  return {
    version: USAGE_VERSION,
    turns: (prior?.turns ?? 0) + 1,
    tokens: {
      input: (prior?.tokens?.input ?? 0) + (Number.isFinite(usage.input) ? usage.input : 0),
      output: (prior?.tokens?.output ?? 0) + (Number.isFinite(usage.output) ? usage.output : 0),
    },
    costMicroUsd: (prior?.costMicroUsd ?? 0) + (known ? cost : 0),
    costStatus: known
      ? (priorUnknown ? 'partial' : 'reported')
      : (priorUnknown ? 'unknown' : priorKnown ? 'partial' : 'unknown'),
  }
}
