import assert from 'node:assert/strict'
import test from 'node:test'
import { toDsGoal, toDsRoomWork, toDsRoster } from './ds-adapter.js'

const room = over => ({
  id: 'room-1',
  name: '目标岛验证',
  goal: '创建一个文件',
  state: 'active',
  leadMemberId: 'lead',
  members: [
    { id: 'lead', name: '规划师', role: 'lead', roleKind: 'planner' },
    { id: 'worker', name: '执行官', role: 'worker', roleKind: 'executor' },
    { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier' },
  ],
  stages: [
    { title: '目标对齐', kind: 'decision', state: 'passed' },
    { title: '创建文件', kind: 'deliverable', state: 'active', acceptance: 'test -f hello.txt' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  messages: [],
  busyMembers: [],
  ...over,
})

test('a studio room becomes the DS goal shape', () => {
  const goal = toDsGoal(room())
  assert.equal(goal.status, 'active')
  assert.equal(goal.current, 1)
  assert.equal(goal.stages[1].status, 'active')
  assert.equal(goal.stages[1].tasks.length, 3)
  assert.match(goal.stages[1].tasks[1].task, /按约定交付/)
  assert.equal(toDsRoster(room().members).byId.worker.name, '执行官')
  assert.deepEqual(toDsRoomWork(room({ busyMembers: ['worker'] })), [{ botId: 'worker' }])
})

test('the goal panel separates acceptance, checks and constraints', () => {
  const goal = toDsGoal(room({
    messages: [{ id: 'e1', kind: 'evidence', meta: { kind: 'command', stage: 1, command: 'test -f hello.txt', exit: 0 } }],
    brief: {
      constraints: ['验收命令: test -f hello.txt', '不要改接口'],
      done: ['创建 hello.txt'],
    },
  }))
  assert.deepEqual(goal.checks, [{
    stage: 1,
    title: '创建文件',
    command: 'test -f hello.txt',
    exit: 0,
    ran: true,
    passed: true,
  }])
  assert.equal(goal.acceptance, '第 2 步：test -f hello.txt')
  assert.deepEqual(goal.constraints, ['不要改接口'])
})

test('a completed room with no commit does not crash', () => {
  const complete = room({ state: 'complete', delivery: { commit: null }, messages: [{ kind: 'conclusion', text: '完成' }] })
  const goal = toDsGoal(complete)
  assert.equal(goal.status, 'complete')
  assert.equal(goal.evidence, undefined)
  assert.equal(goal.summary, '完成')
})
