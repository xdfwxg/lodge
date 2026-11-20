// 同题对照：只算通过率、返工、墙钟和成本，不猜原因。
export const summarizeRuns = rows => {
  const myRows = Array.isArray(rows) ? rows : []
  const priced = myRows.map(item => item.costUsd).filter(value => Number.isFinite(value))
  const passed = myRows.filter(item => item.pass).length
  return {
    runs: myRows.length,
    passed,
    passRate: myRows.length === 0 ? 0 : passed / myRows.length,
    rework: myRows.reduce((total, item) => total + (Number(item.rework) || 0), 0),
    meanMs: myRows.length === 0
      ? 0
      : Math.round(myRows.reduce((total, item) => total + (Number(item.elapsedMs) || 0), 0) / myRows.length),
    meanCostUsd: priced.length === 0 ? null : priced.reduce((total, value) => total + value, 0) / priced.length,
  }
}

const deltaOf = (current, base) => ({
  passRate: current.passRate - base.passRate,
  rework: current.rework - base.rework,
  meanMs: current.meanMs - base.meanMs,
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
