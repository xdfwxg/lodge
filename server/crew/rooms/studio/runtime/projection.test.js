import assert from 'node:assert/strict'
import test from 'node:test'
import { appendHandoffProjection, projectionTargetsOf } from './projection.js'

const room = {
  id: 'room-1',
  roomType: 'studio',
  members: [
    { id: 'lead', name: '规划师', role: 'lead' },
    { id: 'worker', name: '执行官', role: 'worker' },
    { id: 'verifier', name: '验收员', role: 'verifier' },
  ],
}

const storeOf = () => {
  const messages = []
  return {
    messages,
    readMessages: () => messages,
    appendMessage: (_roomId, message) => {
      const stored = { id: `m-${messages.length + 1}`, ...message }
      messages.push(stored)
      return stored
    },
  }
}

test('projection filters self, unknown targets and non-studio rooms', () => {
  assert.deepEqual(projectionTargetsOf({ room, from: 'lead', targets: ['worker', 'lead', 'ghost'] }), ['worker'])
  assert.deepEqual(projectionTargetsOf({ room: { ...room, roomType: 'chat' }, from: 'lead', targets: ['worker'] }), [])
  assert.deepEqual(projectionTargetsOf({ room: { ...room, roomType: undefined }, from: 'lead', targets: ['worker'] }), [])
  assert.deepEqual(projectionTargetsOf({ room, from: 'lead', targets: [] }), [])
})

test('one projection carries every real target and never self', () => {
  const store = storeOf()
  const message = appendHandoffProjection({
    store,
    roomId: room.id,
    room,
    from: 'lead',
    targets: ['worker', 'verifier', 'lead'],
    message: to => `@${to.join('、@')} 开工`,
    meta: { stage: 0, dedupeKey: 'dispatch:1' },
  })
  assert.equal(message.text, '@worker、@verifier 开工')
  assert.deepEqual(message.meta.to, ['worker', 'verifier'])
  assert.equal(message.meta.authorKind, 'system')
  assert.equal(message.meta.dedupeKey, 'dispatch:1')
})

test('the same beat is projected once', () => {
  const store = storeOf()
  const meta = { stage: 0, dedupeKey: 'dispatch:1' }
  assert.notEqual(appendHandoffProjection({ store, roomId: room.id, room, from: 'lead', targets: ['worker'], message: '第一次', meta }), null)
  assert.equal(appendHandoffProjection({ store, roomId: room.id, room, from: 'lead', targets: ['worker'], message: '第二次', meta }), null)
  assert.equal(store.messages.length, 1)
})
