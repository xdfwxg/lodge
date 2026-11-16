import assert from 'node:assert/strict'
import test from 'node:test'
import { batonOf } from './baton.js'

const room = {
  leadSeat: 'lead',
  seatSpecs: [
    { id: 'lead', name: '规划师' },
    { id: 'worker', name: '执行官' },
    { id: 'verifier', name: '验收员' },
  ],
}

test('a dispatch becomes a stage baton with the receiving seats', () => {
  const baton = batonOf({
    kind: 'dispatch',
    authorId: 'lead',
    text: '阶段 2 交给执行官。',
    meta: { stage: 1, workers: ['worker'], acceptance: 'npm test' },
  }, room)
  assert.deepEqual(baton, {
    from: '规划师',
    to: '执行官',
    status: '',
    reason: 'dispatch',
    stage: '2',
    acceptance: 'npm test',
    scope: '',
    rework: false,
    workTurn: null,
    text: '阶段 2 交给执行官。',
  })
})

test('a planner handoff message reads its mention, stage and acceptance', () => {
  const baton = batonOf({
    kind: 'chat',
    authorId: 'lead',
    text: '@执行官 阶段 2「实现」。工作目录：/tmp/room。验收命令：`npm test`。',
  }, room)
  assert.equal(baton.from, '规划师')
  assert.equal(baton.to, '执行官')
  assert.equal(baton.stage, '2')
  assert.equal(baton.acceptance, 'npm test')
})

test('seat names fall back to the UI seat map', () => {
  const baton = batonOf({
    kind: 'dispatch',
    authorId: 'lead',
    text: '派活。',
    meta: { stage: 0, workers: ['worker'] },
  }, { seatSpecs: [] }, { lead: { name: '规划师' }, worker: { name: '执行官' } })
  assert.equal(baton.from, '规划师')
  assert.equal(baton.to, '执行官')
})

test('a dispatch keeps the declared write scope', () => {
  const baton = batonOf({
    kind: 'dispatch',
    authorId: 'lead',
    text: '阶段 2 交给执行官。写范围只有 `src/cli.js` 和 `test/cli.test.js`；验收命令：`npm test`。',
    meta: { stage: 1, workers: ['worker'], acceptance: 'npm test' },
  }, room)
  assert.equal(baton.scope, 'src/cli.js')
})

test('a rework dispatch keeps its rework marker', () => {
  const baton = batonOf({
    kind: 'dispatch',
    authorId: 'lead',
    text: '返工。',
    meta: { stage: 0, workers: ['worker'], rework: true },
  }, room)
  assert.equal(baton.rework, true)
  assert.equal(baton.stage, '1')
})

test('a handoff baton carries the target, status and work turn', () => {
  const baton = batonOf({
    kind: 'handoff',
    authorId: 'worker',
    text: '阶段 2「实现」接力 → 验收员 · 验收 npm test',
    meta: {
      stage: 1,
      from: 'worker',
      to: 'verifier',
      workers: ['verifier'],
      reason: 'review',
      status: 'sent',
      acceptance: 'npm test',
      workTurn: {
        done: ['测试通过'],
        constraints: ['不改测试'],
        evidence: { command: 'npm test', exit: 0, changedFiles: ['src/add.js'] },
        verdict: null,
        candidate: null,
      },
    },
  }, room)
  assert.equal(baton.from, '执行官')
  assert.equal(baton.to, '验收员')
  assert.equal(baton.status, 'sent')
  assert.equal(baton.reason, 'review')
  assert.equal(baton.workTurn.done[0], '测试通过')
  assert.equal(baton.workTurn.evidence.changedFiles[0], 'src/add.js')
})
