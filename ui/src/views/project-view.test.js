import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseStatusOf, projectTrailOf } from './project-view.js'

const rooms = [
  { id: 'p1', name: '第一阶段', goal: '先做一个能跑的原型', state: 'complete', nextRoomId: 'p2' },
  { id: 'p2', name: '第二阶段', goal: '补上真实数据', state: 'complete', sourceRoomId: 'p1', nextRoomId: 'p3' },
  { id: 'p3', name: '第三阶段', goal: '放到真实房间', state: 'active', sourceRoomId: 'p2' },
]

test('a project trail follows the room chain from any phase', () => {
  for (const start of ['p1', 'p2', 'p3']) {
    const trail = projectTrailOf(rooms, start)
    assert.equal(trail.root.id, 'p1')
    assert.deepEqual(trail.phases.map(phase => phase.id), ['p1', 'p2', 'p3'])
    assert.equal(trail.current.id, 'p3')
  }
})

test('a broken or cyclic chain stops instead of looping', () => {
  const cyclic = [
    rooms[0],
    rooms[1],
    { ...rooms[2], nextRoomId: 'p4' },
    { id: 'p4', name: '第四阶段', goal: '循环', state: 'complete', sourceRoomId: 'p3', nextRoomId: 'p1' },
  ]
  const trail = projectTrailOf(cyclic, 'p1')
  assert.deepEqual(trail.phases.map(phase => phase.id), ['p1', 'p2', 'p3', 'p4'])
  assert.equal(projectTrailOf(rooms, 'missing'), null)
  assert.deepEqual(projectTrailOf([rooms[0], { ...rooms[1], nextRoomId: 'missing' }], 'p2').phases.map(phase => phase.id), ['p1', 'p2'])
})

test('phase status reads like a person, not a room state enum', () => {
  assert.equal(phaseStatusOf({ state: 'complete' }), '已交付')
  assert.equal(phaseStatusOf({ state: 'active' }), '进行中')
  assert.equal(phaseStatusOf({ state: 'paused' }), '已暂停')
  assert.equal(phaseStatusOf({ state: 'stopped' }), '已停止')
  assert.equal(phaseStatusOf({ state: 'pending' }), '待开始')
})
