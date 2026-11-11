import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDelivery } from './delivery.js'
import { presentRoom } from './presentation.js'

const room = (over = {}) => ({
  id: 'room-1',
  name: '设置页保存',
  goal: '保存后刷新仍生效',
  state: 'complete',
  completedAt: 100,
  completedCommit: 'abcdef123456',
  independence: 'degraded',
  seatNames: { verifier: '复核' },
  workspace: { provider: 'git', capabilities: { vcs: 'git', commit: true } },
  stages: [
    { title: '对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
  ],
  ...over,
})

const messages = [
  { id: 'e1', kind: 'evidence', seq: 1, ts: 10, meta: { stage: 1, kind: 'command', command: 'npm test', exit: 0, changedFiles: ['src/a.js'] } },
  { id: 'v1', kind: 'verdict', authorId: 'verifier', seq: 2, ts: 11, text: 'PASS', meta: { stage: 1, pass: true, evidenceId: 'e1' } },
]

test('the delivery sheet projection keeps goal, commands, files, verdicts and commit', () => {
  const delivery = buildDelivery(room(), messages)
  assert.equal(delivery.goal, '保存后刷新仍生效')
  assert.equal(delivery.commit, 'abcdef123456')
  assert.equal(delivery.stages[1].commands[0].command, 'npm test')
  assert.deepEqual(delivery.changedFiles, ['src/a.js'])
  assert.equal(delivery.stages[1].verdicts[0].pass, true)
  assert.equal(delivery.commands.length, 1)
})

test('a room event only carries a delivery sheet after completion', () => {
  assert.equal(presentRoom(room({ state: 'active' }), messages).delivery, null)
  assert.equal(presentRoom(room(), messages).delivery.goal, '保存后刷新仍生效')
})
