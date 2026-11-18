import assert from 'node:assert/strict'
import test from 'node:test'
import { addTurnUsage } from './usage.js'

test('reported costs add up', () => {
  const first = addTurnUsage(undefined, { input: 10, output: 5, costUsd: 0.002 })
  const second = addTurnUsage(first, { input: 1, output: 2, costUsd: 0.003 })
  assert.equal(second.turns, 2)
  assert.deepEqual(second.tokens, { input: 11, output: 7 })
  assert.equal(second.costMicroUsd, 5000)
  assert.equal(second.costStatus, 'reported')
})

test('a missing cost stays unknown instead of becoming zero', () => {
  const usage = addTurnUsage(undefined, { input: 10, output: 5, costUsd: null })
  assert.equal(usage.costStatus, 'unknown')
  assert.equal(usage.costMicroUsd, 0)
})

test('mixing known and unknown costs is a lower bound, not a total', () => {
  const known = addTurnUsage(undefined, { input: 1, output: 1, costUsd: 0.004 })
  const partial = addTurnUsage(known, { input: 1, output: 1, costUsd: null })
  assert.equal(partial.costStatus, 'partial')
  assert.equal(partial.costMicroUsd, 4000)
  const alsoPartial = addTurnUsage(partial, { input: 1, output: 1, costUsd: 0.001 })
  assert.equal(alsoPartial.costStatus, 'partial')
  assert.equal(alsoPartial.costMicroUsd, 5000)
})

test('an invalid usage record is ignored', () => {
  assert.equal(addTurnUsage(undefined, null), null)
  assert.equal(addTurnUsage(undefined, 'nope'), null)
})
