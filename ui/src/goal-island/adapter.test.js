import assert from 'node:assert/strict'
import test from 'node:test'
import { toIslandGoal } from './adapter.js'

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

test('a studio room becomes the island goal shape', () => {
  const goal = toIslandGoal(room())
  assert.equal(goal.status, 'active')
  assert.equal(goal.current, 1)
  assert.equal(goal.objective, '创建一个文件')
  assert.deepEqual(goal.stages.map(stage => stage.title), ['目标对齐', '创建文件', '验收与结论'])
  assert.equal(goal.stages[1].status, 'active')
  assert.equal(goal.stages[1].kind, 'deliverable')
  assert.equal(goal.stages[1].tasks, undefined)
})

test('the island carries no check mechanics or side detail', () => {
  const goal = toIslandGoal(room({
    messages: [{ id: 'e1', kind: 'evidence', meta: { kind: 'command', stage: 1, command: 'test -f hello.txt', exit: 0 } }],
    plan: { done: ['创建 hello.txt'] },
    brief: { constraints: ['验收命令: test -f hello.txt', '不要改接口'] },
  }))
  assert.equal(goal.checks, undefined)
  assert.equal(goal.acceptance, undefined)
  assert.equal(goal.deliverables, undefined)
  assert.equal(goal.constraints, undefined)
  assert.equal(goal.summary, undefined)
})

test('the island shows the current step only while a turn is running', () => {
  assert.equal(toIslandGoal(room({ busyMembers: ['worker'], round: 1 })).barLabel, undefined)
  assert.equal(toIslandGoal(room({ busyMembers: [], round: 1 })).barLabel, '空闲中')
  assert.equal(toIslandGoal(room({ busyMembers: [], round: 1, needsYou: { kind: 'decision' } })).barLabel, '等你决定')
  assert.equal(toIslandGoal(room({ busyMembers: [], round: 1, state: 'paused' })).barLabel, '已暂停')
  assert.equal(toIslandGoal(room({ busyMembers: [], round: 1, state: 'stopped' })).barLabel, '已停止')
  assert.equal(toIslandGoal(room({ busyMembers: [], round: 1, state: 'idle' })).barLabel, '空闲中')
})

test('a room that has not run a turn is simply idle', () => {
  assert.equal(toIslandGoal(room({ round: 0, busyMembers: [] })).barLabel, '空闲中')
})

test('a completed room still reports all stages passed', () => {
  const complete = room({
    state: 'idle',
    activeRoundId: null,
    workRound: { id: 'round-1', status: 'completed' },
    stages: room().stages.map(stage => ({ ...stage, state: 'passed' })),
  })
  const goal = toIslandGoal(complete)
  assert.equal(goal.status, 'complete')
  assert.equal(goal.stages.every(stage => stage.status === 'passed'), true)
})
