import assert from 'node:assert/strict'
import test from 'node:test'
import { canSwitchRoomType } from './new-room-dialog.js'

test('a new room starts as a studio; chat is a secondary switch', () => {
  assert.equal(canSwitchRoomType({}), true)
  assert.equal(canSwitchRoomType({ startType: 'studio' }), false)
  assert.equal(canSwitchRoomType({ startType: 'chat' }), false)
  assert.equal(canSwitchRoomType({ seed: { goal: '接着聊' } }), false)
})
