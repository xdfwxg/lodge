import assert from 'node:assert/strict'
import test from 'node:test'
import { batonOf } from './baton.js'

const room = {
  leadMemberId: 'lead',
  members: [
    { id: 'lead', name: '规划师' },
    { id: 'worker', name: '执行官' },
    { id: 'verifier', name: '验收员' },
  ],
}

test('a dispatch becomes a stage baton with the receiving members', () => {
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
    brief: null,
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

test('member names fall back to the UI member map', () => {
  const baton = batonOf({
    kind: 'dispatch',
    authorId: 'lead',
    text: '派活。',
    meta: { stage: 0, workers: ['worker'] },
  }, { members: [] }, { lead: { name: '规划师' }, worker: { name: '执行官' } })
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

test('a handoff without an assignment still names its workers', () => {
  const baton = batonOf({
    kind: 'handoff',
    authorId: 'lead',
    text: '把清单交给执行官。',
    meta: {
      from: 'lead',
      workers: ['worker'],
      stage: 1,
      acceptance: 'test -f RELEASE_CHECKLIST.md',
      reason: 'dispatch',
      status: 'sent',
    },
  }, room)
  assert.equal(baton.to, '执行官')
  assert.equal(baton.status, 'sent')
  assert.equal(baton.archived, undefined)
})

test('a handoff baton reads its assignment brief', () => {
  const assignment = {
    id: 'as-1',
    stageIndex: 1,
    fromMemberId: 'worker',
    toMemberId: 'verifier',
    reason: 'review',
    status: 'sent',
    brief: { done: ['测试通过'], constraints: ['不改测试'], acceptance: 'npm test' },
    evidenceIds: ['e-1'],
    verdictIds: ['v-1'],
  }
  const baton = batonOf({
    kind: 'handoff',
    authorId: 'worker',
    text: '阶段 2「实现」接力 → 验收员 · 验收 npm test',
    meta: { assignmentId: 'as-1', stage: 1, status: 'sent' },
  }, {
    ...room,
    assignments: [assignment],
    messages: [
      { id: 'e-1', kind: 'evidence', meta: { exit: 0, changedFiles: ['src/add.js'] } },
      { id: 'v-1', kind: 'verdict', text: 'PASS\n测试通过', meta: { pass: true } },
    ],
  })
  assert.equal(baton.from, '执行官')
  assert.equal(baton.to, '验收员')
  assert.equal(baton.status, 'sent')
  assert.equal(baton.reason, 'review')
  assert.equal(baton.acceptance, 'npm test')
  assert.equal(baton.brief.done[0], '测试通过')
  assert.equal(baton.brief.constraints[0], '不改测试')
  assert.equal(baton.brief.evidence.exit, 0)
  assert.equal(baton.brief.evidence.changedFiles[0], 'src/add.js')
  assert.equal(baton.brief.verdict.pass, true)
  assert.match(baton.brief.verdict.text, /测试通过/)
})

test('a handoff whose assignment is gone says the record is archived', () => {
  const baton = batonOf({
    kind: 'handoff',
    authorId: 'lead',
    text: '阶段 1「实现」接力 → 执行官',
    meta: { assignmentId: 'as-gone', stage: 0, status: 'sent' },
  }, { ...room, assignments: [], messages: [] })
  assert.equal(baton.from, '规划师')
  assert.equal(baton.to, '记录已归档')
  assert.equal(baton.archived, true)
  assert.equal(baton.acceptance, '')
  assert.equal(baton.brief, null)
})
