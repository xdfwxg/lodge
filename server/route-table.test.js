import assert from 'node:assert/strict'
import test from 'node:test'
import { ROOM_ACTIONS, matchRoomAction } from './route-table.js'

test('every room action is recognized by the HTTP route', () => {
  for (const action of ROOM_ACTIONS) {
    assert.deepEqual(
      matchRoomAction(`/api/rooms/room-1/${action}`),
      { roomId: 'room-1', action },
      `missing route for ${action}`,
    )
  }
  assert.equal(new Set(ROOM_ACTIONS).size, ROOM_ACTIONS.length)
})

test('unknown actions and nested paths are not room actions', () => {
  assert.equal(matchRoomAction('/api/rooms/room-1/nope'), null)
  assert.equal(matchRoomAction('/api/rooms/room-1/rewind/extra'), null)
  assert.equal(matchRoomAction('/api/rooms//rewind'), null)
  assert.equal(matchRoomAction('/api/rooms/room-1'), null)
})
