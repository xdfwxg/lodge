import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReview } from './review.js'

const room = {
  id: 'room-r1',
  name: '复盘验证',
  goal: '做一个设置页',
  state: 'active',
  usage: { costMicroUsd: 1200, budgetMicroUsd: 5_000_000, turns: 4 },
  stages: [
    { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
    { title: '回归', kind: 'deliverable', state: 'active', acceptance: 'npm run e2e', partial: { failed: ['乙'], workers: ['甲'], at: 7 } },
  ],
}

const messages = [
  { id: 'm1', seq: 1, kind: 'evidence', ts: 1, meta: { kind: 'turn', stage: 0, output: JSON.stringify({ tools: [{ name: 'Bash', count: 2, failed: 1 }, { name: 'Read', count: 1, failed: 0 }], usage: { input: 100, output: 40, cachedInput: 10 } }) } },
  { id: 'm2', seq: 2, kind: 'evidence', ts: 2, meta: { kind: 'command', stage: 0, command: 'npm test', exit: 0 } },
  { id: 'm3', seq: 3, kind: 'verdict', ts: 3, text: 'PASS', meta: { pass: true, stage: 0 } },
  { id: 'm4', seq: 4, kind: 'evidence', ts: 4, meta: { kind: 'command', stage: 1, command: 'npm run e2e', exit: 1 } },
  { id: 'm5', seq: 5, kind: 'verdict', ts: 5, text: 'REJECT：回归没过', meta: { pass: false, stage: 1 } },
  { id: 'm6', seq: 6, kind: 'system', ts: 6, text: '并行合并冲突：等待处理' },
]

test('review derives usage, rework and failures from messages only', () => {
  const review = buildReview(room, messages)
  assert.equal(review.usage.costMicroUsd, 1200)
  assert.equal(review.usage.turns, 4)
  assert.deepEqual(review.usage.tokens, { input: 100, output: 40, cachedInput: 10, total: 140 })
  assert.equal(review.usage.tokenMessages, 1)
  assert.equal(review.evidence.commands, 2)
  assert.equal(review.evidence.passed, 1)
  assert.equal(review.evidence.failed, 1)
  assert.equal(review.rework.total, 1)
  assert.deepEqual(review.rework.byStage, [{ index: 1, title: '回归', count: 1 }])
  assert.deepEqual(review.stages.map(stage => [stage.title, stage.rejects, stage.failed]), [
    ['实现', 0, 0],
    ['回归', 1, 1],
  ])
  assert.deepEqual(review.stages[1].partial, { failed: ['乙'], workers: ['甲'], at: 7 })
  assert.deepEqual(review.tools, [
    { name: 'Bash', count: 2, failed: 1 },
    { name: 'Read', count: 1, failed: 0 },
  ])
  assert.deepEqual(review.failures.map(item => item.kind), ['system', 'rework', 'command'])
  assert.match(review.failures[1].text, /回归没过/)
})

test('review leaves tokens empty when the runtime reported none', () => {
  const review = buildReview(room, [
    { id: 'm1', seq: 1, kind: 'evidence', meta: { kind: 'command', stage: 0, command: 'npm test', exit: 0 } },
  ])
  assert.equal(review.usage.tokens, null)
  assert.deepEqual(review.tools, [])
})
