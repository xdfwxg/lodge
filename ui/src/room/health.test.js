import assert from 'node:assert/strict'
import test from 'node:test'
import { healthOf } from './health.js'

const room = over => ({
  stages: [
    { title: '对齐', state: 'passed' },
    { title: '实现', state: 'active' },
  ],
  members: [{ id: 'executor', name: '执行官' }],
  stageDiagnostics: {
    1: {
      at: 100,
      memberId: 'executor',
      outcome: 'evidence',
      assessment: {
        evidence: ['耗时 2s', '证据：e1'],
        unknown: ['费用未知'],
        next: ['核对证据和交接状态，等待验收'],
      },
    },
  },
  usage: { turns: 2, costMicroUsd: 4200, costStatus: 'reported' },
  messages: [
    { kind: 'rework', meta: { stage: 1 } },
    { kind: 'human-context', meta: { stage: 1 } },
  ],
  needsYou: { label: '待确认', detail: '看一下结果' },
  ...over,
})

test('the health card reads the active stage diagnostic and room usage', () => {
  const health = healthOf(room())
  assert.equal(health.index, 1)
  assert.equal(health.title, '实现')
  assert.equal(health.memberName, '执行官')
  assert.equal(health.usage, '2 回合 · $0.0042')
  assert.equal(health.reworks, 1)
  assert.equal(health.human, 1)
  assert.equal(health.diagnostic.assessment.unknown[0], '费用未知')
  assert.equal(health.memoryCount, 0)
})

test('a room without an active stage has no health card', () => {
  assert.equal(healthOf(room({ stages: [{ title: '对齐', state: 'passed' }] })), null)
})

test('an unknown cost reads as unknown, not zero', () => {
  const health = healthOf(room({ usage: { turns: 1, costMicroUsd: 0, costStatus: 'unknown' } }))
  assert.equal(health.usage, '1 回合 · 费用未知')
})
