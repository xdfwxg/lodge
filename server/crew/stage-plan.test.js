import assert from 'node:assert/strict'
import test from 'node:test'
import { editStages } from './stage-plan.js'

const room = (over = {}) => ({
  id: 'room-1',
  state: 'active',
  imported: false,
  demo: false,
  stages: [
    { title: '目标对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
    { title: '回归', kind: 'deliverable', state: 'pending', acceptance: 'npm run e2e', dependsOn: [1] },
    { title: '验收与结论', kind: 'decision', state: 'pending', dependsOn: [2] },
  ],
  ...over,
})

test('only pending, non-final stages can be edited', () => {
  assert.match(editStages(room(), 'update', 1, { title: '改', kind: 'deliverable', acceptance: 'x' }).error, /没开始/)
  assert.match(editStages(room(), 'update', 3, { title: '改', kind: 'decision' }).error, /系统维护/)
  assert.match(editStages(room({ imported: true }), 'add', null, { title: 'x', kind: 'decision' }).error, /不能编辑/)
})

test('a pending deliverable needs an acceptance command', () => {
  assert.match(editStages(room(), 'update', 2, { title: '回归', kind: 'deliverable' }).error, /验收命令/)
  const result = editStages(room(), 'update', 2, { title: '回归二', kind: 'deliverable', acceptance: 'npm run e2e' })
  assert.equal(result.stages[2].title, '回归二')
  assert.equal(result.stages[2].state, 'pending')
})

test('adding a stage inserts before the system acceptance stage', () => {
  const result = editStages(room(), 'add', null, { title: '文档', kind: 'deliverable', acceptance: 'npm run docs' })
  assert.equal(result.stages.length, 5)
  assert.equal(result.stages[3].title, '文档')
  assert.equal(result.stages[4].title, '验收与结论')
  assert.deepEqual(result.stages[4].dependsOn, [3])
})

test('removing a pending stage keeps the final dependency valid', () => {
  const added = editStages(room(), 'add', null, { title: '文档', kind: 'deliverable', acceptance: 'npm run docs' })
  const result = editStages({ ...room(), stages: added.stages }, 'remove', 3, {})
  assert.equal(result.stages.length, 4)
  assert.equal(result.stages[3].title, '验收与结论')
  assert.deepEqual(result.stages[3].dependsOn, [2])
})

test('pending stages can swap positions but cannot cross active or final stages', () => {
  const first = editStages(room(), 'move', 2, { to: 2 })
  assert.equal(first.stages[2].title, '回归')
  const moved = editStages(room(), 'move', 2, { to: 1 })
  assert.match(moved.error, /只能和未开始阶段交换/)
  const added = editStages(room(), 'add', null, { title: '文档', kind: 'deliverable', acceptance: 'npm run docs' })
  const swapped = editStages({ ...room(), stages: added.stages }, 'move', 2, { to: 3 })
  assert.equal(swapped.stages[2].title, '文档')
  assert.equal(swapped.stages[3].title, '回归')
  assert.deepEqual(swapped.stages[2].dependsOn, [3])
  assert.deepEqual(swapped.stages[3].dependsOn, [1])
})
