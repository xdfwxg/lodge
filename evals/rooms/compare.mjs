// 同题对照：只算通过率、返工、墙钟和成本，不猜原因。
const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
}

export const summarizeRuns = rows => {
  const myRows = Array.isArray(rows) ? rows : []
  const priced = myRows.map(item => item.costUsd).filter(value => Number.isFinite(value))
  const durations = myRows.map(item => Number(item.elapsedMs) || 0)
  const passed = myRows.filter(item => item.pass).length
  return {
    runs: myRows.length,
    passed,
    passRate: myRows.length === 0 ? 0 : passed / myRows.length,
    rework: myRows.reduce((total, item) => total + (Number(item.rework) || 0), 0),
    meanMs: myRows.length === 0
      ? 0
      : Math.round(durations.reduce((total, value) => total + value, 0) / myRows.length),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    meanCostUsd: priced.length === 0 ? null : priced.reduce((total, value) => total + value, 0) / priced.length,
  }
}

const deltaOf = (current, base) => ({
  passRate: current.passRate - base.passRate,
  rework: current.rework - base.rework,
  meanMs: current.meanMs - base.meanMs,
  p50Ms: current.p50Ms - base.p50Ms,
  p95Ms: current.p95Ms - base.p95Ms,
  meanCostUsd: current.meanCostUsd === null || base.meanCostUsd === null
    ? null
    : current.meanCostUsd - base.meanCostUsd,
})

export const compareRuns = (rows, baselineResults) => {
  if (!Array.isArray(baselineResults)) return null
  const current = summarizeRuns(rows)
  const base = summarizeRuns(baselineResults)
  const variants = [...new Set([
    ...rows.map(item => item.variant),
    ...baselineResults.map(item => item.variant),
  ])].filter(variant => typeof variant === 'string' && variant !== '').map(variant => {
    const now = summarizeRuns(rows.filter(item => item.variant === variant))
    const before = summarizeRuns(baselineResults.filter(item => item.variant === variant))
    return { variant, current: now, baseline: before, delta: deltaOf(now, before) }
  })
  return { current, baseline: base, delta: deltaOf(current, base), byVariant: variants }
}
