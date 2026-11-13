import assert from 'node:assert/strict'
import test from 'node:test'
import { gateStatus, stageNeedsHuman } from './stage-gate.js'

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

test('a manual stage still asks the human to sign after the Verifier passes', () => {
  const manual = {
    needsYou: { kind: 'signoff', stage: 0 },
    verifiers: ['v1'],
    stages: [{ manual: true, kind: 'decision', state: 'active' }],
  }
  assert.equal(stageNeedsHuman(manual, 0), true)
})

test('manual gate status follows the Verifier verdict', () => {
  const base = {
    state: 'active',
    demo: false,
    live: true,
    openQuestion: null,
    verifiers: ['v1'],
    stages: [{ title: '交付', kind: 'decision', manual: true, state: 'active' }],
    messages: [{ id: 'e1', kind: 'evidence', seq: 1, meta: { stage: 0, kind: 'manual' } }],
  }
  assert.equal(gateStatus(base), '等待复核')
  assert.equal(gateStatus({
    ...base,
    messages: [...base.messages, { id: 'v1', kind: 'verdict', seq: 2, meta: { stage: 0, pass: true, evidenceId: 'e1' } }],
  }), '等你签字')
  assert.equal(gateStatus({
    ...base,
    messages: [...base.messages, { id: 'v1', kind: 'verdict', seq: 2, meta: { stage: 0, pass: false, evidenceId: 'e1' } }],
  }), '验收退回')
})
