import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTO_REWORK_WINDOW_MS, MAX_AUTO_REWORKS, nextAutoRework } from './auto-rework.js'

const room = over => ({ usage: { costMicroUsd: 0, budgetMicroUsd: 0 }, ...over })
const fail = (state, over = {}) => nextAutoRework({
  state,
  command: 'npm test',
  exit: 1,
  output: 'FAIL a.test.js\n  expected 1 to be 2',
  room: room(),
  now: 1_000,
  ...over,
})

test('the first failure starts a rework with the failure signature', () => {
  const first = fail(undefined)
  assert.equal(first.retry, true)
  assert.equal(first.state.attempts, 1)
  assert.match(first.state.signature, /expected 1 to be 2/)
})

test('the same failure twice stops instead of spinning', () => {
  const first = fail(undefined)
  const second = fail(first.state, { now: 2_000 })
  assert.equal(second.retry, false)
  assert.equal(second.reason, 'same-failure')
})

test('a different failure keeps going until the attempt limit', () => {
  let state = fail(undefined).state
  for (let index = 1; index < MAX_AUTO_REWORKS; index += 1) {
    const next = fail(state, { output: `FAIL attempt ${index}`, now: 1_000 + index })
    assert.equal(next.retry, true)
    state = next.state
  }
  const over = fail(state, { output: 'FAIL a new one', now: 5_000 })
  assert.equal(over.retry, false)
  assert.equal(over.reason, 'attempts')
})

test('a long loop or an exhausted budget stops as well', () => {
  const timedOut = fail({ attempts: 1, firstAt: 1_000, signature: 'x' }, {
    output: 'other failure',
    now: 1_000 + AUTO_REWORK_WINDOW_MS + 1,
  })
  assert.equal(timedOut.reason, 'time')
  const broke = fail({ attempts: 1, firstAt: 1_000, signature: 'x' }, {
    output: 'other failure',
    now: 2_000,
    room: room({ usage: { costMicroUsd: 500, budgetMicroUsd: 500 } }),
  })
  assert.equal(broke.reason, 'budget')
})
