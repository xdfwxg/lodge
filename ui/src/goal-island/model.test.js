import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeIndex, evidenceFor, goalAnswers, goalFaces, islandStatus, rejectsFor, seatState, trackTone, verdictFor,
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
  workers: ['worker', 'worker-2'],
  verifiers: ['verifier'],
  seatNames: { worker: '前端', 'worker-2': '后端', verifier: '复核' },
  seatSpecs: seats,
  messages: [
    { id: 'e1', seq: 1, kind: 'evidence', authorId: 'worker', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0 } },
    { id: 'v1', seq: 2, kind: 'verdict', authorId: 'verifier', text: 'REJECT：刷新没生效', meta: { pass: false, stage: 1 } },
    { id: 'v2', seq: 3, kind: 'verdict', authorId: 'verifier', text: 'REJECT：少了主题色', meta: { pass: false, stage: 1 } },
  ],
  ...over,
})

test('island status reflects pause reasons and needs-you labels', () => {
  assert.deepEqual(islandStatus(room({ state: 'complete' })), { label: '目标达成', tone: 'done' })
  assert.deepEqual(islandStatus(room({ state: 'paused', needsYou: { kind: 'budget', label: '预算已用尽 · 等你处理' } })),
    { label: '预算已用尽 · 等你处理', tone: 'paused' })
  assert.deepEqual(islandStatus(room({ state: 'paused', pauseReason: 'mcp', needsYou: { kind: 'mcp', label: 'MCP 熔断 · 等你恢复' } })),
    { label: 'MCP 熔断 · 等你恢复', tone: 'paused' })
  assert.deepEqual(islandStatus(room({ needsYou: { kind: 'rework', label: '验收退回 · 等你处理' } })),
    { label: '验收退回 · 等你处理', tone: 'paused' })
})

test('stage track and answers stay tied to the active stage and acceptance', () => {
  const current = room()
  assert.equal(activeIndex(current), 1)
  assert.equal(trackTone(current, current.stages[1], 1), 'active')
  assert.equal(trackTone(current, current.stages[0], 0), 'passed')
  assert.equal(trackTone(current, current.stages[2], 2), 'pending')
  assert.equal(trackTone(room({ state: 'paused' }), current.stages[1], 1), 'paused')
  assert.deepEqual(goalAnswers(current, 1), [
    ['目标', '给设置页加保存，并保证刷新后生效', 'goal'],
    ['进度', '2/3 · 实现', 'progress'],
    ['怎么算过', 'npm test', 'acceptance'],
  ])
  assert.equal(goalAnswers(room({ state: 'complete', stages: [{ title: '实现', kind: 'deliverable', state: 'passed' }] }), 0)[1][1], '1/1 · 目标达成')
})

test('faces prefer current task owners and keep busy state separate', () => {
  const faces = goalFaces(room({ live: true, busy: true, busySeats: ['worker'] }), seats, 1)
  assert.deepEqual(faces.seats.map(seat => seat.id), ['worker', 'worker-2'])
  assert.deepEqual([...faces.working], ['worker'])
  const fallback = goalFaces(room({ live: true, stages: [{ title: '实现', kind: 'deliverable', state: 'active', tasks: [] }], busy: true, busySeats: ['verifier'] }), seats, 0)
  assert.deepEqual(fallback.seats.map(seat => seat.id), ['verifier'])
})

test('evidence, verdict and rework projections are stage-scoped', () => {
  const current = room()
  assert.deepEqual(evidenceFor(current, 1).map(message => message.id), ['e1'])
  assert.equal(verdictFor(current, 1).id, 'v2')
  assert.deepEqual(rejectsFor(current, 1).map(message => message.id), ['v1', 'v2'])
  assert.equal(seatState(current, current.stages[1], 1, 'worker'), 'done')
  assert.equal(seatState(current, current.stages[1], 1, 'worker-2'), 'failed')
})
