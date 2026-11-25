import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../store.js'
import { reconcileCompletions, reconcileRounds } from './recovery.js'

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

test('startup cancels work left by a terminal round whose pointer is still active', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '工作室', roomType: 'studio', state: 'active', activeRoundId: 'round-1', lastRoundId: null })
    store.writeWorkRound({ id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'completed', goal: 'g', stages: [] })
    store.writeAssignment({
      id: 'as-1', roomId: 'room-1', workRoundId: 'round-1', stageIndex: 0,
      fromMemberId: 'planner', toMemberId: 'worker', reason: 'dispatch',
      brief: {}, status: 'sent', flags: {},
    })
    assert.equal(reconcileRounds({ store }), 1)
    assert.equal(store.readAssignment('as-1').status, 'cancelled')
    assert.ok(store.readEvents('room-1').some(event => event.type === 'assignment.cancelled'))
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('startup completes a round whose stages all passed but delivery got stuck', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', roomType: 'studio', state: 'active', activeRoundId: 'round-1',
    })
    store.writeWorkRound({
      id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: 'g',
      stages: [{ title: '实现', kind: 'deliverable', state: 'passed' }],
    })
    const done = []
    const completed = reconcileCompletions({
      store,
      completeRoom: room => {
        done.push(room.id)
        return { ...room, state: 'idle', activeRoundId: null, workRound: { ...room.workRound, status: 'completed' } }
      },
    })
    assert.equal(completed, 1)
    assert.deepEqual(done, ['room-1'])
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('startup leaves a round with a pending stage alone', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', roomType: 'studio', state: 'active', activeRoundId: 'round-1',
    })
    store.writeWorkRound({
      id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: 'g',
      stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    })
    let called = 0
    const completed = reconcileCompletions({ store, completeRoom: () => { called += 1; return null } })
    assert.equal(completed, 0)
    assert.equal(called, 0)
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
