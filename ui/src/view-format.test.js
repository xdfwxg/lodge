import assert from 'node:assert/strict'
import test from 'node:test'
import { durationOf } from './view-format.js'

test('durations read like elapsed time, not decimals', () => {
  assert.equal(durationOf(0), '0s')
  assert.equal(durationOf(12_400), '12s')
  assert.equal(durationOf(72_000), '1m 12s')
  assert.equal(durationOf(120_000), '2m')
  assert.equal(durationOf(3_720_000), '1h 2m')
  assert.equal(durationOf(-5), '0s')
})
