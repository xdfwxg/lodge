import assert from 'node:assert/strict'
import test from 'node:test'
import { toDsGoal, toDsRoomWork, toDsRoster } from './ds-adapter.js'

const room = over => ({
  id: 'room-1',
  name: '目标岛验证',
  goal: '创建一个文件',
  state: 'active',
  leadSeat: 'lead',
  members: ['lead', 'worker', 'verifier'],
  seatSpecs: [
    { id: 'lead', name: '规划师', role: 'lead' },
    { id: 'worker', name: '执行官', role: 'worker' },
    { id: 'verifier', name: '验收员', role: 'verifier' },
  ],
  stages: [
    { title: '目标对齐', kind: 'decision', state: 'passed' },
    { title: '创建文件', kind: 'deliverable', state: 'active', acceptance: 'test -f hello.txt' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  messages: [],
  busySeats: [],
  ...over,
})

test('a studio room becomes the DS goal shape', () => {
  const goal = toDsGoal(room())
  assert.equal(goal.status, 'active')
  assert.equal(goal.current, 1)
  assert.equal(goal.stages[1].status, 'active')
  assert.equal(goal.stages[1].tasks.length, 3)
  assert.match(goal.stages[1].tasks[1].task, /test -f hello.txt/)
  assert.equal(toDsRoster(room().seatSpecs).byId.worker.name, '执行官')
  assert.deepEqual(toDsRoomWork(room({ busySeats: ['worker'] })), [{ botId: 'worker' }])
})

test('a completed room with no commit does not crash', () => {
  const complete = room({ state: 'complete', delivery: { commit: null }, messages: [{ kind: 'conclusion', text: '完成' }] })
  const goal = toDsGoal(complete)
  assert.equal(goal.status, 'complete')
  assert.equal(goal.evidence, undefined)
  assert.equal(goal.summary, '完成')
})
