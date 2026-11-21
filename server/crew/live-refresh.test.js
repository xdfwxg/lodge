import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomRefresher } from './kernel/live/refresh.js'

test('busy members carry a start time that survives repeated refreshes', async () => {
  let working = true
  let room = {
    id: 'room-1',
    kind: 'room',
    state: 'active',
    members: [{ id: 'worker', body: { kind: 'base', roomRef: 'base-1' } }],
  }
  const store = {
    readRoom: () => room,
    readRooms: () => [room],
    updateRoom: (id, mutate) => {
      const current = { ...room, usage: { ...room.usage } }
      if (mutate(current) === null) return null
      room = current
      return current
    },
  }
  const engine = {
    rooms: async () => [{
      id: 'base-1',
      working,
      }],
  }
  const refresher = createRoomRefresher({
    store,
    engine,
    emit: () => {},
  })
  await refresher.refresh({ roomId: 'room-1', refreshedAt: 0 }, { force: true })
  const started = room.busySince
  assert.equal(typeof started, 'number')
  assert.deepEqual(room.busyMembers, ['worker'])
  await new Promise(resolve => setTimeout(resolve, 5))
  await refresher.refresh({ roomId: 'room-1', refreshedAt: 0 }, { force: true })
  assert.equal(room.busySince, started)
  working = false
  await refresher.refresh({ roomId: 'room-1', refreshedAt: 0 }, { force: true })
  assert.deepEqual(room.busyMembers, [])
  assert.equal(room.busySince, null)
})
