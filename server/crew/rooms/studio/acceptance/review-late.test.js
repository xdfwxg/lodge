import assert from 'node:assert/strict'
import test from 'node:test'
import { lateReviewStillValid } from './review-policy.js'

const room = (overrides = {}) => ({
  state: 'active',
  stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
  ...overrides,
})

const evidence = (id = 'e1', seq = 10) => ({
  id,
  kind: 'evidence',
  seq,
  ts: 1000,
  meta: { stage: 0, kind: 'result' },
})

const pending = { stage: 0, evidenceId: 'e1', requestedAt: 1500 }

test('a late verdict is accepted while the stage and evidence are unchanged', () => {
  assert.equal(lateReviewStillValid({
    room: room(),
    messages: [evidence()],
    pending,
  }), true)
})

test('a late verdict is ignored once a newer evidence exists', () => {
  assert.equal(lateReviewStillValid({
    room: room(),
    messages: [evidence('e1'), evidence('e2', 12)],
    pending,
  }), false)
})

test('a late verdict is ignored after the stage moved on', () => {
  assert.equal(lateReviewStillValid({
    room: room({ stages: [{ title: '实现', kind: 'deliverable', state: 'passed' }] }),
    messages: [evidence()],
    pending,
  }), false)
})

test('a late verdict is ignored after the stage was reworked', () => {
  assert.equal(lateReviewStillValid({
    room: room(),
    messages: [
      evidence(),
      { id: 'r1', kind: 'rework', seq: 11, ts: 2000, meta: { stage: 0 } },
    ],
    pending,
  }), false)
})
