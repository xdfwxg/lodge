import assert from 'node:assert/strict'
import test from 'node:test'
import { hasNeedsAction, needsAction } from './needs.js'

test('progress states are not needs-you items', () => {
  assert.equal(needsAction({ needsYou: { kind: 'review', actionable: false } }), null)
  assert.equal(needsAction({ needsYou: { kind: 'signoff', actionable: false } }), null)
  assert.equal(hasNeedsAction({ needsYou: { kind: 'review', actionable: false } }), false)
})

test('a real decision still reaches the room', () => {
  assert.equal(needsAction({ needsYou: { kind: 'confirm' } }).kind, 'confirm')
  assert.equal(hasNeedsAction({ needsYou: { kind: 'approval' } }), true)
  assert.equal(needsAction({}), null)
})
