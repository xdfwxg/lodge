import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../store.js'
import { reconcileRounds } from './recovery.js'

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-round-recovery-'))
  return { dir, store: createStore({ dataDir: dir }) }
}

test('startup clears an active pointer to a terminal round', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '工作室', roomType: 'studio', state: 'active', activeRoundId: 'round-1', lastRoundId: null })
    store.writeWorkRound({ id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'completed', goal: 'g', stages: [] })
    assert.equal(reconcileRounds({ store }), 1)
    const room = store.readRoom('room-1')
    assert.equal(room.state, 'idle')
    assert.equal(room.activeRoundId, null)
    assert.equal(room.lastRoundId, 'round-1')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('startup reconnects a room with an open round and stops an archived one', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '工作室', roomType: 'studio', state: 'idle', activeRoundId: null })
    store.writeWorkRound({ id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: 'g', stages: [] })
    reconcileRounds({ store })
    assert.equal(store.readRoom('room-1').activeRoundId, 'round-1')
    assert.equal(store.readRoom('room-1').state, 'active')

    store.writeRoom({ id: 'room-2', name: '已归档', roomType: 'studio', state: 'idle', archivedAt: 1 })
    store.writeWorkRound({ id: 'round-2', roomId: 'room-2', ordinal: 1, status: 'active', goal: 'g', stages: [] })
    reconcileRounds({ store })
    const archived = store.readRoom('room-2')
    assert.equal(archived.activeRoundId, null)
    assert.equal(archived.state, 'stopped')
    assert.equal(archived.workRound.status, 'stopped')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
