import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeIndex, buildGoalView, evidenceFor, islandStatus, rejectsFor, memberState,
  verdictFor, verdictForMember, verdictsFor,
} from './model.js'

const seats = [
  { id: 'worker', name: '前端', role: 'worker' },
  { id: 'worker-2', name: '后端', role: 'worker' },
  { id: 'verifier', name: '复核', role: 'verifier' },
]

const room = over => ({
  id: 'room-1',
  state: 'active',
  live: false,
  goal: '给设置页加保存',
  brief: { objective: '给设置页加保存，并保证刷新后生效' },
  stages: [
    { title: '对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test', tasks: [
      { id: '1:worker', title: '前端', owner: 'worker', status: 'reported', evidenceRef: 'e1' },
      { id: '1:worker-2', title: '后端', owner: 'worker-2', status: 'failed', evidenceRef: null },
    ], partial: { failed: ['worker-2'], workers: ['worker'] } },
    { title: '回归', kind: 'deliverable', state: 'pending', acceptance: 'npm run e2e' },
  ],
  members: seats,
  messages: [
    { id: 'e1', seq: 1, kind: 'evidence', authorId: 'worker', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0 } },
    { id: 'v1', seq: 2, kind: 'verdict', authorId: 'verifier', text: 'REJECT：刷新没生效', meta: { pass: false, stage: 1 } },
    { id: 'v2', seq: 3, kind: 'verdict', authorId: 'verifier', text: 'REJECT：少了主题色', meta: { pass: false, stage: 1 } },
  ],
  ...over,
})

test('island status reflects pause reasons and needs-you labels', () => {
  assert.deepEqual(islandStatus(room({ state: 'complete' })), { label: '已交付', tone: 'done' })
  assert.deepEqual(islandStatus(room({ state: 'paused', needsYou: { kind: 'idle', label: '可以接着聊' } })),
    { label: '已暂停 · 可以接着聊', tone: 'paused' })
  assert.deepEqual(islandStatus(room({ state: 'paused', pauseReason: 'mcp', needsYou: { kind: 'mcp', label: '连接中断' } })),
    { label: '连接中断', tone: 'paused' })
  assert.deepEqual(islandStatus(room({ state: 'paused', pauseReason: 'approval', needsYou: { kind: 'approval', label: '确认超时' } })),
    { label: '确认超时', tone: 'paused' })
  assert.deepEqual(islandStatus(room({ needsYou: { kind: 'rework', label: '待重做' } })),
    { label: '待重做', tone: 'paused' })
})

test('progress follows the active stage and closes at completion', () => {
  const current = room()
  assert.equal(activeIndex(current), 1)
  assert.deepEqual(buildGoalView(current, seats).progress, { value: 2, total: 3 })
  assert.deepEqual(buildGoalView(room({ state: 'complete' }), seats).progress, { value: 3, total: 3 })
})

test('evidence, verdict and rework projections are stage-scoped', () => {
  const current = room()
  assert.deepEqual(evidenceFor(current, 1).map(message => message.id), ['e1'])
  assert.equal(verdictFor(current, 1).id, 'v2')
  assert.deepEqual(rejectsFor(current, 1).map(message => message.id), ['v1', 'v2'])
  assert.equal(memberState(current, current.stages[1], 1, 'worker'), 'done')
  assert.equal(memberState(current, current.stages[1], 1, 'worker-2'), 'failed')
})

test('multiple verifier verdicts aggregate on the current evidence round', () => {
  const secondSeat = { id: 'verifier-2', name: '复核二', role: 'verifier' }
  const current = room({
    members: [...seats, secondSeat],
    messages: [
      { id: 'e1', seq: 1, kind: 'evidence', authorId: 'worker', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0 } },
      { id: 'v1', seq: 2, kind: 'verdict', authorId: 'verifier', text: 'PASS', meta: { pass: true, stage: 1, evidenceId: 'e1' } },
    ],
  })
  assert.deepEqual(verdictsFor(current, 1).map(message => message.authorId), ['verifier'])
  assert.equal(verdictForMember(current, 1, 'verifier').id, 'v1')
  assert.equal(buildGoalView(current, [...seats, secondSeat]).stages[1].verdict.pending, true)

  const all = room({
    ...current,
    messages: [
      ...current.messages,
      { id: 'v2', seq: 3, kind: 'verdict', authorId: 'verifier-2', text: 'PASS', meta: { pass: true, stage: 1, evidenceId: 'e1' } },
    ],
  })
  const view = buildGoalView(all, [...seats, secondSeat])
  assert.equal(view.stages[1].verdict.pass, true)
  assert.equal(view.stages[1].verdict.text, '全部 2 位验收员通过')
  assert.deepEqual(view.stages[1].verdicts.map(item => item.author), ['复核', '复核二'])

  const rejected = room({
    ...all,
    messages: [
      current.messages[0],
      current.messages[1],
      { id: 'v2', seq: 3, kind: 'verdict', authorId: 'verifier-2', text: 'REJECT', meta: { pass: false, stage: 1, evidenceId: 'e1' } },
    ],
  })
  assert.match(buildGoalView(rejected, [...seats, secondSeat]).stages[1].verdict.text, /复核二/)

  const failedAgain = room({
    ...all,
    messages: [
      ...all.messages,
      { id: 'e2', seq: 4, kind: 'evidence', authorId: 'worker', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 1 } },
    ],
  })
  assert.deepEqual(verdictsFor(failedAgain, 1), [])
  assert.equal(buildGoalView(failedAgain, [...seats, secondSeat]).stages[1].verdict, null)
})

test('member names come from the room roster, never from base names', () => {
  const secondSeat = { id: 'verifier-2', name: '复核二', role: 'verifier' }
  const current = room({
    members: [...seats, secondSeat],
    messages: [
      { id: 'e1', seq: 1, kind: 'evidence', authorId: 'worker', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0 } },
      { id: 'v1', seq: 2, kind: 'verdict', authorId: 'verifier', text: 'PASS', meta: { pass: true, stage: 1, evidenceId: 'e1' } },
      { id: 'v2', seq: 3, kind: 'verdict', authorId: 'verifier-2', text: 'PASS', meta: { pass: true, stage: 1, evidenceId: 'e1' } },
    ],
  })
  const view = buildGoalView(current, [...seats, secondSeat])
  assert.deepEqual(view.stages[1].verdicts.map(item => item.author), ['复核', '复核二'])
  assert.doesNotMatch(JSON.stringify(view), /f0d790/)
})
