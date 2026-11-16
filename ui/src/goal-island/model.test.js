import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeIndex, evidenceFor, rejectsFor, memberState,
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

test('the active stage and stage-scoped evidence stay aligned', () => {
  const current = room()
  assert.equal(activeIndex(current), 1)
  assert.deepEqual(evidenceFor(current, 1).map(message => message.id), ['e1'])
  assert.equal(verdictFor(current, 1).id, 'v2')
  assert.deepEqual(rejectsFor(current, 1).map(message => message.id), ['v1', 'v2'])
  assert.equal(memberState(current, current.stages[1], 1, 'worker'), 'done')
  assert.equal(memberState(current, current.stages[1], 1, 'worker-2'), 'failed')
})

test('multiple verifier verdicts keep the latest per member', () => {
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

  const failedAgain = room({
    ...current,
    messages: [
      ...current.messages,
      { id: 'e2', seq: 4, kind: 'evidence', authorId: 'worker', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 1 } },
    ],
  })
  assert.deepEqual(verdictsFor(failedAgain, 1), [])
})
