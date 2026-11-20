import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureLodgeRoom } from './lodge.js'
import { LODGE_ROOM_ID } from '../../../shared/lodge.js'

test('an existing Lodge host receives the current host soul', async () => {
  const calls = []
  const existing = {
    id: LODGE_ROOM_ID,
    archivedAt: null,
    chatHost: { memberRef: 'bot-lodge' },
  }
  const store = { readRoom: () => existing }
  const engine = {
    patchMemberBot: async (id, payload) => calls.push({ id, payload }),
  }
  const room = await ensureLodgeRoom({
    store,
    engine,
    live: {},
    workspace: { root: () => '/tmp' },
  })
  assert.equal(room, existing)
  assert.equal(calls[0].id, 'bot-lodge')
  assert.match(calls[0].payload.soul, /听清楚/)
  assert.match(calls[0].payload.soul, /分流/)
  assert.match(calls[0].payload.soul, /收束/)
})
