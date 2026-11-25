import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from './store.js'

test('holding a member goes to that room, not whichever room is open', async () => {
  const calls = []
  const bridge = globalThis.lodge
  globalThis.lodge = {
    request: async (path, body) => {
      calls.push({ path, body })
      return { ok: true, status: 200, body: { ok: true } }
    },
  }
  try {
    const store = createStore()
    await store.holdMember('room-b', 'worker', true)
    assert.deepEqual(calls, [
      { path: '/api/rooms/room-b/hold', body: { memberId: 'worker', held: true } },
    ])
  } finally {
    if (bridge === undefined) delete globalThis.lodge
    else globalThis.lodge = bridge
  }
})
