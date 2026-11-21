import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../store.js'
import { failRound, rejectRound, stopRound } from './lifecycle.js'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-lifecycle-'))
  const store = createStore({ dataDir: dir })
  store.writeRoom({
    id: 'room-1', name: '工作室', roomType: 'studio', state: 'idle',
    activeRoundId: null, lastRoundId: null, members: [],
  })
  store.startWorkRound({
    roomId: 'room-1',
    round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: '修登录超时', stages: [] },
  })
  return { dir, store }
}

const teardown = ({ dir, store }) => {
  store.db.close()
  rmSync(dir, { recursive: true, force: true })
}

const live = { cancel: async () => {}, detach: () => {} }
const emit = () => {}

test('stopping a round closes it and leaves the room idle', async () => {
  const ctx = setup()
  try {
    const result = await stopRound({ store: ctx.store, live, emit, room: ctx.store.readRoom('room-1'), reason: '不做了' })
    assert.equal(result.ok, true)
    const room = ctx.store.readRoom('room-1')
    assert.equal(room.state, 'idle')
    assert.equal(room.activeRoundId, null)
    assert.equal(room.lastRoundId, 'round-1')
    assert.equal(room.workRound.status, 'stopped')
  } finally {
    teardown(ctx)
  }
})

test('a rejected or failed round is terminal and clears the room pointer', async () => {
  for (const finish of [rejectRound, failRound]) {
    const ctx = setup()
    try {
      const result = await finish({ store: ctx.store, live, emit, room: ctx.store.readRoom('room-1'), reason: '目标不成立' })
      assert.equal(result.ok, true)
      const room = ctx.store.readRoom('room-1')
      assert.equal(room.activeRoundId, null)
      assert.equal(room.state, 'idle')
      assert.equal(room.workRound.status, finish === rejectRound ? 'rejected' : 'failed')
    } finally {
      teardown(ctx)
    }
  }
})
