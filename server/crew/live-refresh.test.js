import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomRefresher } from './live-refresh.js'

test('refresh records usage through the injected port', async () => {
  let room = {
    id: 'room-1',
    kind: 'room',
    state: 'active',
    seatRooms: { worker: { id: 'base-1' } },
    usage: { turns: 0, costMicroUsd: 0, tokens: { input: 0, output: 0, cachedInput: 0 } },
  }
  const recorded = []
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
      working: false,
      usage: { turns: 2, costMicroUsd: 3_000, tokens: { input: 10, output: 20, cachedInput: 5 } },
    }],
  }
  const refresher = createRoomRefresher({
    store,
    engine,
    emit: () => {},
    usage: { record: (updated, previous) => recorded.push([updated, previous]) },
  })
  await refresher.refresh({ roomId: 'room-1', refreshedAt: 0 }, { force: true })
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0][0].usage.turns, 2)
  assert.equal(recorded[0][0].usage.costMicroUsd, 3_000)
  assert.equal(recorded[0][1].turns, 0)
})
