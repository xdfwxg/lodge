import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_STAGE_REWORKS, relayAfterVerdict } from './relay.js'

test('a pass hands the room back to the planner', () => {
  assert.deepEqual(relayAfterVerdict({ pass: true, targets: ['executor'] }), {
    kind: 'summary',
    to: 'planner',
  })
})

test('a reject goes straight back to the executor until the budget runs out', () => {
  assert.deepEqual(relayAfterVerdict({ pass: false, reworksUsed: 0, targets: ['executor'] }), {
    kind: 'rework',
    to: 'executor',
    targets: ['executor'],
  })
  assert.equal(relayAfterVerdict({
    pass: false,
    reworksUsed: MAX_STAGE_REWORKS,
    targets: ['executor'],
  }).kind, 'human')
})

test('merge conflicts and missing executors go to the planner for a human call', () => {
  assert.deepEqual(
    relayAfterVerdict({ pass: false, mergeConflict: true, targets: ['executor'] }),
    { kind: 'human', to: 'planner', reason: 'merge-conflict' },
  )
  assert.deepEqual(
    relayAfterVerdict({ pass: false, targets: [] }),
    { kind: 'human', to: 'planner', reason: 'no-executor' },
  )
})
