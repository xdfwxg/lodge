import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDelivery } from './rooms/studio/delivery.js'
import { presentRoom } from './presentation.js'

const room = (over = {}) => ({
  id: 'room-1',
  name: '设置页保存',
  goal: '保存后刷新仍生效',
  state: 'complete',
  completedAt: 100,
  completedCommit: 'abcdef123456',
  independence: 'degraded',
  members: [{ id: 'verifier', name: '复核', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-verifier', name: 'Verifierf0d790' } }],
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

test('the delivery card keeps goal, commands, files, verdicts and commit', () => {
  const delivery = buildDelivery(room(), messages)
  assert.equal(delivery.goal, '保存后刷新仍生效')
  assert.equal(delivery.commit, 'abcdef123456')
  assert.equal(delivery.stages[1].commands[0].command, 'npm test')
  assert.deepEqual(delivery.changedFiles, ['src/a.js'])
  assert.equal(delivery.stages[1].verdicts[0].pass, true)
  assert.equal(delivery.commands.length, 1)
  assert.equal(delivery.evidenceCount, 1)
  assert.equal(delivery.kind, 'text')
})

test('the delivery keeps the room usage and its unknown state', () => {
  const reported = buildDelivery(room({
    usage: { turns: 2, tokens: { input: 10, output: 5 }, costMicroUsd: 4200, costStatus: 'reported' },
  }), messages)
  assert.equal(reported.usage.costStatus, 'reported')
  assert.equal(reported.usage.costMicroUsd, 4200)
  const unknown = buildDelivery(room({ usage: { turns: 1, costMicroUsd: 0, costStatus: 'unknown' } }), messages)
  assert.equal(unknown.usage.costStatus, 'unknown')
  assert.equal(buildDelivery(room(), messages).usage, null)
})

test('a room event only carries a delivery card after completion', () => {
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
  assert.equal(delivery.artifacts[0].relativePath, 'logo/logo.svg')
  assert.equal(delivery.artifacts[0].kind, 'image')
  assert.equal(delivery.kind, 'image')
  assert.equal(delivery.workspacePath, '/tmp/room')
})

test('a delivery with different result shapes is mixed', () => {
  const delivery = buildDelivery(room({ repoPath: '/tmp/room' }), [
    { id: 'a1', kind: 'activity', ts: 11, meta: { stage: 1, artifacts: [
      { path: '/tmp/room/report.md', bytes: 10 },
      { path: '/tmp/room/shot.png', bytes: 20 },
    ] } },
  ])
  assert.equal(delivery.kind, 'mixed')
  assert.deepEqual(delivery.artifacts.map(artifact => artifact.kind), ['document', 'image'])
})

test('a demo delivery drops the sample prefix and carries artifact content', () => {
  const delivery = buildDelivery(room({ demo: true, name: '示例：发布前检查清单' }), [
    { id: 'a1', kind: 'activity', ts: 11, meta: { stage: 1, artifacts: [
      { path: 'RELEASE_CHECKLIST.md', bytes: 5, content: '- [ ] 检查' },
    ] } },
  ])
  assert.equal(delivery.name, '发布前检查清单')
  assert.equal(delivery.sample, true)
  assert.equal(delivery.artifacts[0].kind, 'document')
  assert.equal(delivery.kind, 'document')
  assert.equal(delivery.artifacts[0].content, '- [ ] 检查')
})

test('a real delivery does not send artifact content to the card', () => {
  const delivery = buildDelivery(room({ repoPath: '/tmp/room' }), [
    { id: 'a1', kind: 'activity', ts: 11, meta: { stage: 1, artifacts: [
      { path: '/tmp/room/RELEASE_CHECKLIST.md', bytes: 5, content: '- [ ] 检查' },
    ] } },
  ])
  assert.equal(delivery.artifacts[0].content, undefined)
})

test('a manual stage carries its changed files into the delivery card', () => {
  const delivery = buildDelivery(room(), [
    { id: 'm1', kind: 'evidence', seq: 1, ts: 10, meta: { stage: 1, kind: 'manual', files: ['NOTES.md'], changedFiles: ['NOTES.md'] } },
  ])
  assert.deepEqual(delivery.stages[1].manual.changedFiles, ['NOTES.md'])
  assert.deepEqual(delivery.changedFiles, ['NOTES.md'])
})

test('delivery verdicts print roster names, not base names', () => {
  const withRoster = room({
    members: [{ id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-verifier', name: 'Verifierf0d790' } }],
  })
  const delivery = buildDelivery(withRoster, messages)
  assert.equal(delivery.memberNames.verifier, '验收员')
})
