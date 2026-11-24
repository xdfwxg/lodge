import assert from 'node:assert/strict'
import test from 'node:test'
import {
  POOL_MAX_FALSE_PASS_RATE,
  mergeVerifierPools,
  poolFromProbeResults,
  verifierPoolIssue,
} from './verifier-pool.js'

const row = (over = {}) => ({
  kind: 'defect',
  outcome: 'caught',
  verifierEngine: 'claude',
  verifierModel: 'opus',
  ...over,
})

const many = (count, over) => Array.from({ length: count }, () => row(over))

test('a model needs enough defect and clean samples before it is eligible', () => {
  const pool = poolFromProbeResults([
    ...many(10),
    ...many(5, { kind: 'clean', outcome: 'correct-pass' }),
  ])
  const entry = pool.models['claude:opus']
  assert.equal(entry.status, 'eligible')
  assert.equal(entry.falsePassRate, 0)
  assert.deepEqual(verifierPoolIssue({ pool, engine: 'claude', model: 'opus' }), {})
})

test('too few samples stay insufficient instead of pretending to be measured', () => {
  const pool = poolFromProbeResults([
    ...many(9),
    ...many(5, { kind: 'clean', outcome: 'correct-pass' }),
  ])
  assert.equal(pool.models['claude:opus'].status, 'insufficient')
  assert.match(verifierPoolIssue({ pool, engine: 'claude', model: 'opus' }).warning, /样本还不够/)
})

test('a model above the false-pass threshold is kept out of the pool', () => {
  const pool = poolFromProbeResults([
    ...many(9),
    row({ outcome: 'false-pass' }),
    ...many(5, { kind: 'clean', outcome: 'correct-pass' }),
  ])
  assert.equal(pool.models['claude:opus'].status, 'excluded')
  assert.equal(pool.models['claude:opus'].falsePassRate, 0.1)
  assert.ok(pool.models['claude:opus'].falsePassRate > POOL_MAX_FALSE_PASS_RATE)
  assert.match(verifierPoolIssue({ pool, engine: 'claude', model: 'opus' }).error, /误放率/)
})

test('an unmeasured model is allowed with a warning, not silently trusted', () => {
  const pool = poolFromProbeResults([])
  assert.match(verifierPoolIssue({ pool, engine: 'pi', model: 'pi-3' }).warning, /还没有实测记录/)
  assert.deepEqual(verifierPoolIssue({ pool: null, engine: 'pi', model: 'pi-3' }), {})
})

test('writing one model keeps the other measured models in the pool', () => {
  const first = poolFromProbeResults([
    ...many(10),
    ...many(5, { kind: 'clean', outcome: 'correct-pass' }),
  ])
  const second = poolFromProbeResults([
    ...many(10, { verifierEngine: 'pi', verifierModel: 'pi-3' }),
    ...many(5, { verifierEngine: 'pi', verifierModel: 'pi-3', kind: 'clean', outcome: 'correct-pass' }),
  ])
  const merged = mergeVerifierPools(first, second)
  assert.deepEqual(Object.keys(merged.models).sort(), ['claude:opus', 'pi:pi-3'])
  assert.equal(merged.models['claude:opus'].status, 'eligible')
})

test('a false rejection is recorded separately from false passes', () => {
  const pool = poolFromProbeResults([
    ...many(10),
    ...many(5, { kind: 'clean', outcome: 'correct-pass' }),
    { ...row({ kind: 'clean', outcome: 'false-reject' }) },
  ])
  const entry = pool.models['claude:opus']
  assert.equal(entry.cleanSamples, 6)
  assert.equal(entry.falseReject, 1)
  assert.equal(entry.status, 'eligible')
})
