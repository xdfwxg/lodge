import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateRoomGate } from './rooms/studio/gate.js'

test('a room kind without a gate bypasses it', () => {
  const result = evaluateRoomGate({ enabled: false, goal: '', plan: null, verify: 'manual', acceptance: '' })
  assert.equal(result.decision, 'allow')
})

test('studio rejects an unusable target before planning', () => {
  const result = evaluateRoomGate({
    enabled: true,
    goal: '',
    plan: null,
    verify: 'test',
    acceptance: '',
  })
  assert.equal(result.decision, 'reject')
  assert.ok(result.reasons.includes('目标为空'))
  assert.ok(result.reasons.includes('交付型工作室没有验收标准'))
})

test('advisor advice is returned but never changes the decision', () => {
  const result = evaluateRoomGate({
    enabled: true,
    goal: '做一件事',
    plan: { done: ['完成'], stages: [] },
    verify: 'manual',
    acceptance: '',
    advice: [{ source: 'advisor', score: 0.2 }],
  })
  assert.equal(result.decision, 'allow')
  assert.deepEqual(result.advice, [{ source: 'advisor', score: 0.2 }])
})
