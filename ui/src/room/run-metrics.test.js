import assert from 'node:assert/strict'
import test from 'node:test'
import { runMetricsOf, toolLabelOf } from './run-metrics.js'

const room = over => ({
  stages: [
    { title: '对齐', state: 'passed' },
    { title: '实现', state: 'active' },
  ],
  usage: { turns: 2, costMicroUsd: 4200, costStatus: 'reported' },
  messages: [
    { kind: 'rework', meta: { stage: 1 } },
    { kind: 'human-context', meta: { stage: 1 } },
  ],
  ...over,
})

test('run metrics read the active stage, usage and interventions', () => {
  const metrics = runMetricsOf(room())
  assert.equal(metrics.usage, '2 轮 · $0.0042')
  assert.equal(metrics.reworks, 1)
  assert.equal(metrics.human, 1)
  assert.equal(metrics.memoryCount, 0)
})

test('a room without an active stage has no run metrics', () => {
  assert.equal(runMetricsOf(room({ stages: [{ title: '对齐', state: 'passed' }] })), null)
})

test('an unknown cost reads as unknown, not zero', () => {
  const metrics = runMetricsOf(room({ usage: { turns: 1, costMicroUsd: 0, costStatus: 'unknown' } }))
  assert.equal(metrics.usage, '1 轮 · 费用未知')
})

test('tool rows read as Chinese actions with what they touched', () => {
  assert.deepEqual([
    toolLabelOf({ text: 'Read', meta: { action: 'read', target: 'README.md' } }),
    toolLabelOf({ text: 'Bash', meta: { action: 'exec', detail: 'cd /repo && npm test' } }),
    toolLabelOf({ text: 'Edit', meta: { action: 'write', target: 'src/a.js' } }),
    toolLabelOf({ text: 'lodge_gate', meta: { action: 'gate' } }),
  ], ['读了 README.md', '跑了 npm test', '改了 src/a.js', '提交了判定'])
})
