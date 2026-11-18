import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeRoomSnapshot } from './store.js'

test('a reconnect snapshot updates room state but keeps local messages', () => {
  const local = [
    { id: 'a', state: 'complete', stages: [{ state: 'passed' }], messages: [{ id: 'm1' }] },
    { id: 'b', state: 'active', messages: [] },
  ]
  const fresh = [
    { id: 'a', state: 'active', stages: [{ state: 'active' }], messages: [] },
    { id: 'c', state: 'active', stages: [], messages: [] },
  ]
  const merged = mergeRoomSnapshot(local, fresh)
  assert.deepEqual(merged.map(room => room.id), ['a', 'c'])
  assert.equal(merged[0].state, 'active')
  assert.deepEqual(merged[0].stages, [{ state: 'active' }])
  assert.deepEqual(merged[0].messages, [{ id: 'm1' }])
})
