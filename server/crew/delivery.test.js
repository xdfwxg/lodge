import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDelivery, deliveryMarkdown } from './delivery.js'
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

test('manual evidence is not a passed command and artifacts stay in the workspace', () => {
  const delivery = buildDelivery(room({
    repoPath: '/tmp/room',
    worktrees: { worker: '/tmp/room/worker' },
  }), [
    { id: 'm1', kind: 'evidence', seq: 1, ts: 10, meta: { stage: 1, kind: 'command', command: 'manual', exit: 127 } },
    { id: 'a1', kind: 'activity', seq: 2, ts: 11, meta: { stage: 1, artifacts: [
      { path: '/tmp/room/worker/logo/logo.svg', bytes: 10 },
      { path: '/tmp/outside/MEMORY.md', bytes: 20 },
    ] } },
  ])
  assert.equal(delivery.commands.length, 0)
  assert.deepEqual(delivery.artifacts.map(artifact => artifact.path), ['/tmp/room/worker/logo/logo.svg'])
  assert.equal(delivery.workspacePath, '/tmp/room')
})

test('the delivery sheet exports as portable markdown', () => {
  const text = deliveryMarkdown(buildDelivery(room(), messages))
  assert.match(text, /# 交付单：设置页保存/)
  assert.match(text, /结论 commit：abcdef123456/)
  assert.match(text, /npm test` · exit 0/)
  assert.match(text, /复核 · PASS/)
  assert.match(text, /src\/a\.js/)
})
