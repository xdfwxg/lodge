import assert from 'node:assert/strict'
import test from 'node:test'
import { ROUND_STATUS } from '../../../shared/work-round.js'
import { terminalRoundStatus, transitionRound } from './round.js'

test('a round moves from planning to active and only ends once', () => {
  const active = transitionRound(ROUND_STATUS.planning, 'activate')
  assert.equal(active.ok, true)
  assert.equal(active.state, ROUND_STATUS.active)

  const completed = transitionRound(ROUND_STATUS.active, 'complete')
  assert.equal(completed.ok, true)
  assert.equal(completed.state, ROUND_STATUS.completed)
  assert.equal(terminalRoundStatus(completed.state), true)
})

test('stop, reject, fail and supersede are terminal transitions', () => {
  for (const event of ['stop', 'reject', 'fail', 'supersede']) {
    const result = transitionRound(ROUND_STATUS.active, event)
    assert.equal(result.ok, true)
    assert.equal(terminalRoundStatus(result.state), true)
  }
})

test('a terminal round cannot move again', () => {
  assert.equal(transitionRound(ROUND_STATUS.completed, 'complete').ok, false)
  assert.equal(transitionRound(ROUND_STATUS.stopped, 'activate').ok, false)
  assert.equal(transitionRound('missing', 'complete').ok, false)
})
