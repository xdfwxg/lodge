import test from 'node:test'
import assert from 'node:assert/strict'
import { humanGateActionsOf } from './human-gate.js'

test('the human gate exposes only actions that are valid now', () => {
  assert.deepEqual(humanGateActionsOf({ canPass: true, canRework: true }).map(action => action.id), ['pass', 'rework'])
  assert.deepEqual(humanGateActionsOf({ canRetry: true, canNoRetry: true }).map(action => action.id), ['retry', 'no-retry'])
  assert.deepEqual(humanGateActionsOf({ state: 'stale', canPass: true }), [])
  assert.deepEqual(humanGateActionsOf(), [])
})
