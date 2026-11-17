import assert from 'node:assert/strict'
import test from 'node:test'
import { dateTimeOf, durationOf, timeOf } from './view-format.js'

test('formal times use yyyy-MM-dd HH:mm and inline clocks stay HH:mm', () => {
  const ts = new Date(2026, 10, 16, 20, 29).getTime()
  assert.equal(dateTimeOf(ts), '2026-11-16 20:29')
  assert.equal(timeOf(ts), '20:29')
})

test('durations read like elapsed time, not decimals', () => {
  assert.equal(durationOf(0), '0s')
  assert.equal(durationOf(12_400), '12s')
  assert.equal(durationOf(72_000), '1m 12s')
  assert.equal(durationOf(120_000), '2m')
  assert.equal(durationOf(3_720_000), '1h 2m')
  assert.equal(durationOf(-5), '0s')
})
