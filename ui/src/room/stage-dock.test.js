import assert from 'node:assert/strict'
import test from 'node:test'
import { stageNeedsHuman } from './stage-dock.js'

const room = (needsYou, verifiers = []) => ({ needsYou, verifiers })

test('a paused or waiting room keeps the stage gate out of the way', () => {
  assert.equal(stageNeedsHuman(room(undefined), 1), false)
  assert.equal(stageNeedsHuman(room({ kind: 'idle', stage: null }), 1), false)
  assert.equal(stageNeedsHuman(room({ kind: 'review', stage: 1 }, ['v1']), 1), false)
  assert.equal(stageNeedsHuman(room({ kind: 'approval', stage: null }), 1), false)
})

test('the gate appears only when the current stage needs the human', () => {
  assert.equal(stageNeedsHuman(room({ kind: 'rework', stage: 1 }), 1), true)
  assert.equal(stageNeedsHuman(room({ kind: 'decision', stage: 1 }), 1), true)
  assert.equal(stageNeedsHuman(room({ kind: 'setup', stage: 1 }), 1), true)
  assert.equal(stageNeedsHuman(room({ kind: 'rework', stage: 0 }), 1), false)
})

test('signoff stays in the result card when a verifier exists', () => {
  assert.equal(stageNeedsHuman(room({ kind: 'signoff', stage: 1 }, ['v1']), 1), false)
  assert.equal(stageNeedsHuman(room({ kind: 'signoff', stage: 1 }, []), 1), true)
})
