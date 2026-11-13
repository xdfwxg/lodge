import assert from 'node:assert/strict'
import test from 'node:test'
import { listRoomTypes, resolveRoomType } from './room-types/index.js'

test('the room picker exposes only chat and studio', () => {
  assert.deepEqual(listRoomTypes().map(item => item.id), ['studio', 'chat'])
})

test('only studio and chat resolve; other values fail closed', () => {
  assert.equal(resolveRoomType(undefined).id, 'studio')
  assert.equal(resolveRoomType('studio').id, 'studio')
  assert.equal(resolveRoomType('chat').id, 'chat')
  assert.equal(resolveRoomType('task'), null)
  assert.equal(resolveRoomType('roundtable'), null)
  assert.equal(resolveRoomType('archive'), null)
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
  ], { verify: 'manual' }), /规划师\/执行官\/验收员/)
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
