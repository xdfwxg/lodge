import assert from 'node:assert/strict'
import test from 'node:test'
import { listRoomTypes, resolveRoomType } from './room-types/index.js'

test('the room picker exposes only chat and studio', () => {
  assert.deepEqual(listRoomTypes().map(item => item.id), ['studio', 'chat'])
})

test('new room types resolve to studio or chat; an omitted type stays legacy task', () => {
  assert.equal(resolveRoomType(undefined).id, 'task')
  assert.equal(resolveRoomType('studio').id, 'studio')
  assert.equal(resolveRoomType('chat').id, 'chat')
})

test('legacy room types remain readable', () => {
  assert.equal(resolveRoomType('task').id, 'task')
  assert.equal(resolveRoomType('roundtable').id, 'roundtable')
  assert.equal(resolveRoomType('archive').id, 'archive')
})

test('studio seats derive from exactly three role classes', () => {
  const studio = resolveRoomType('studio')
  assert.doesNotThrow(() => studio.validateRoster([
    { role: 'lead', name: '规划师' },
    { role: 'worker', name: '执行者' },
    { role: 'verifier', name: '验收员' },
  ], { verify: 'test' }))
  assert.throws(() => studio.validateRoster([
    { role: 'lead', name: '规划师' },
    { role: 'worker', name: '执行者' },
    { role: 'observer', name: '观察员' },
  ], { verify: 'manual' }), /规划师\/执行者\/验收员/)
  assert.throws(() => studio.validateRoster([
    { role: 'worker', name: '执行者' },
    { role: 'verifier', name: '验收员' },
  ], { verify: 'manual' }), /规划师/)
  assert.throws(() => studio.validateRoster([
    { role: 'lead', name: '规划师' },
    { role: 'worker', name: '执行者' },
  ], { verify: 'test' }), /验收席位/)
  assert.throws(() => studio.validateRoster([
    { role: 'lead', name: '规划师' },
    { role: 'worker', name: '执行者' },
  ], { verify: 'manual' }), /验收席位/)
})
