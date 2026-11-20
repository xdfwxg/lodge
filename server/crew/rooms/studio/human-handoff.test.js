import assert from 'node:assert/strict'
import test from 'node:test'
import { humanHandoffStageOf } from './human-handoff.js'

const room = over => ({
  stages: [
    { title: '对齐', state: 'passed' },
    { title: '实现', state: 'active' },
    { title: '验收与结论', state: 'pending' },
  ],
  lastPlannerDecision: { stage: 1, verdictId: 'v1', kind: 'human' },
  ...over,
})
const verdict = { id: 'v1', kind: 'verdict', meta: { stage: 1, pass: false } }

test('an active stage waiting for the human is found by its verdict', () => {
  assert.equal(humanHandoffStageOf(room(), [verdict]), 1)
})

test('a stale verdict or a different decision does not capture the composer', () => {
  const stale = { id: 'v-old', kind: 'verdict', meta: { stage: 1, pass: false } }
  assert.equal(humanHandoffStageOf(room(), [stale]), null)
  assert.equal(humanHandoffStageOf(room({ lastPlannerDecision: { stage: 1, verdictId: 'v1', kind: 'rework' } }), [verdict]), null)
  assert.equal(humanHandoffStageOf(room({ lastPlannerDecision: { stage: 0, verdictId: 'v1', kind: 'human' } }), [verdict]), null)
})

test('a room without an active stage never captures input', () => {
  const done = room({ stages: [{ title: '对齐', state: 'passed' }] })
  assert.equal(humanHandoffStageOf(done, [verdict]), null)
})
