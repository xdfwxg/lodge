import assert from 'node:assert/strict'
import test from 'node:test'
import { humanGateOf } from './human-gate.js'

const room = over => ({
  state: 'active',
  stages: [
    { title: '对齐', state: 'passed' },
    { title: '实现', state: 'active' },
  ],
  messages: [{ id: 'v1', kind: 'verdict', meta: { stage: 1 } }],
  lastPlannerDecision: {
    stage: 1,
    verdictId: 'v1',
    kind: 'human',
    judgment: { reason: '缺少接口约定', actionRequired: '给我接口约定，或允许按现状重做' },
  },
  ...over,
})

test('a current human handoff becomes an explicit gate card', () => {
  const gate = humanGateOf(room())
  assert.equal(gate.stage, 1)
  assert.equal(gate.title, '实现')
  assert.equal(gate.actionRequired, '给我接口约定，或允许按现状重做')
})

test('a later verdict or a paused room leaves no gate card', () => {
  assert.equal(humanGateOf(room({
    messages: [{ id: 'v1', kind: 'verdict', meta: { stage: 1 } }, { id: 'v2', kind: 'verdict', meta: { stage: 1 } }],
  })), null)
  assert.equal(humanGateOf(room({ state: 'paused' })), null)
  assert.equal(humanGateOf(room({ lastPlannerDecision: { stage: 1, verdictId: 'v1', kind: 'rework' } })), null)
})
