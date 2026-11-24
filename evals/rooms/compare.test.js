import assert from 'node:assert/strict'
import test from 'node:test'
import { compareRuns, summarizeRuns } from './compare.mjs'

const row = over => ({ pass: false, rework: 0, elapsedMs: 1000, costUsd: 0.1, ...over })

test('summaries keep unknown cost unknown instead of zero', () => {
  const summary = summarizeRuns([row({ pass: true, costUsd: null }), row({ rework: 2, elapsedMs: 3000, costUsd: 0.3 })])
  assert.equal(summary.passRate, 0.5)
  assert.equal(summary.rework, 2)
  assert.equal(summary.meanMs, 2000)
  assert.equal(summary.meanCostUsd, 0.3)
  assert.equal(summarizeRuns([]).meanCostUsd, null)
})

test('p95 is the tail, not the median, on small samples', () => {
  const summary = summarizeRuns([100, 200, 300].map(elapsedMs => row({ elapsedMs })))
  assert.equal(summary.p50Ms, 200)
  assert.equal(summary.p95Ms, 300)
})

test('comparison gives deltas per variant and overall', () => {
  const comparison = compareRuns([
    row({ variant: 'auto · 有记忆', pass: true, rework: 0, elapsedMs: 5000, costUsd: 0.2 }),
    row({ variant: 'auto', pass: false, rework: 1, elapsedMs: 9000, costUsd: 0.4 }),
  ], [
    row({ variant: 'auto · 有记忆', pass: false, rework: 1, elapsedMs: 8000, costUsd: 0.3 }),
    row({ variant: 'auto', pass: false, rework: 1, elapsedMs: 8000, costUsd: 0.3 }),
  ])
  assert.equal(comparison.delta.passRate, 0.5)
  assert.equal(comparison.delta.rework, -1)
  assert.equal(comparison.delta.meanMs, -1000)
  assert.equal(comparison.byVariant.find(item => item.variant === 'auto · 有记忆').delta.passRate, 1)
  assert.equal(comparison.byVariant.find(item => item.variant === 'auto').delta.meanMs, 1000)
})

test('an old baseline without results does not produce a comparison', () => {
  assert.equal(compareRuns([], undefined), null)
})
