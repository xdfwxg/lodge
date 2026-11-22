import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('every room action the UI posts exists in the HTTP route table', () => {
  const source = readFileSync(new URL('../ui/src/store.js', import.meta.url), 'utf8')
  const posted = [...source.matchAll(/\/api\/rooms\/\$\{[^}]+\}\/([a-z-]+)`/g)].map(match => match[1])
  assert.ok(posted.length > 0)
  for (const action of new Set(posted)) {
    assert.ok(ROOM_ACTIONS.includes(action), `store posts /${action} but the route table does not allow it`)
  }
})

test('unknown actions and nested paths are not room actions', () => {
  assert.equal(matchRoomAction('/api/rooms/room-1/nope'), null)
  assert.equal(matchRoomAction('/api/rooms/room-1/rewind/extra'), null)
  assert.equal(matchRoomAction('/api/rooms//rewind'), null)
  assert.equal(matchRoomAction('/api/rooms/room-1'), null)
})
