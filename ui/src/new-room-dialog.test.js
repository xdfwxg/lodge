import assert from 'node:assert/strict'
import test from 'node:test'
import { roomTypeOptionsFor } from './new-room-dialog.js'

test('the sidebar new-room entry offers studio and chat side by side', () => {
  assert.deepEqual(roomTypeOptionsFor({}), [
    { value: 'studio', label: '工作室' },
    { value: 'chat', label: '聊天室' },
  ])
})

test('a handoff or an explicit start type keeps the room type fixed', () => {
  assert.deepEqual(roomTypeOptionsFor({ startType: 'chat' }), [])
  assert.deepEqual(roomTypeOptionsFor({ seed: { goal: '接着聊' } }), [])
})
