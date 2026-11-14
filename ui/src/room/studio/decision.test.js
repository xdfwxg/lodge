import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStudioDecision } from './decision.js'

test('a timed-out review offers a retry action', () => {
  const decision = buildStudioDecision({
    state: 'active',
    needsYou: { kind: 'review-timeout', stage: 1, label: '复核超时' },
    stages: [
      { index: 0, state: 'passed', title: '实现', kind: 'deliverable' },
      { index: 1, state: 'active', title: '验收', kind: 'deliverable' },
    ],
    verifiers: ['v1'],
    seatSpecs: [],
    busy: false,
  }, { stages: [{ index: 1, state: 'active', title: '验收', evidence: [] }] })
  assert.equal(decision.key, 'review-timeout')
  assert.deepEqual(decision.primary, { label: '重新复核', action: 'verify', stage: 1 })
})
