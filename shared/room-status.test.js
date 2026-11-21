import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveredRoundOf, idleDelivered, roomStatusOf, roundDelivered, roundOpen, roundStatusOf } from './room-status.js'

test('room lifecycle never reports a delivered round as a room state', () => {
  assert.equal(roomStatusOf({ state: 'idle' }), 'idle')
  assert.equal(roomStatusOf({ state: 'active', activeRoundId: 'round-1' }), 'active')
  assert.equal(roomStatusOf({ state: 'paused', activeRoundId: 'round-1' }), 'paused')
  assert.equal(roomStatusOf({ state: 'stopped' }), 'stopped')
  assert.equal(roomStatusOf({ state: 'idle', archivedAt: 1 }), 'archived')
})

test('a completed round is a round fact, not a room state', () => {
  const room = {
    state: 'idle',
    activeRoundId: null,
    workRound: { id: 'round-1', status: 'completed' },
  }
  assert.equal(roomStatusOf(room), 'idle')
  assert.equal(roundStatusOf(room), 'completed')
  assert.equal(roundDelivered(room), true)
  assert.equal(deliveredRoundOf(room)?.id, 'round-1')
  assert.equal(roundOpen(room), false)
})

test('round summaries can answer delivery for an idle studio', () => {
  const room = {
    state: 'idle',
    rounds: [
      { id: 'round-1', status: 'completed' },
      { id: 'round-2', status: 'stopped' },
    ],
  }
  assert.equal(deliveredRoundOf(room)?.id, 'round-1')
  assert.equal(roundStatusOf({ status: 'active' }), 'active')
  assert.equal(roundOpen({ status: 'planning' }), true)
})

test('idleDelivered is the current state, not the last delivered round', () => {
  const activeNext = {
    state: 'active',
    activeRoundId: 'round-2',
    workRound: { id: 'round-2', status: 'active' },
    rounds: [{ id: 'round-1', status: 'completed' }],
  }
  assert.equal(roundDelivered(activeNext), true)
  assert.equal(idleDelivered(activeNext), false)
  assert.equal(idleDelivered({ state: 'idle', workRound: { id: 'round-1', status: 'completed' } }), true)
  assert.equal(idleDelivered({ state: 'idle', rounds: [{ id: 'round-1', status: 'completed' }, { id: 'round-2', status: 'stopped' }] }), false)
  assert.equal(idleDelivered({ state: 'active', activeRoundId: 'round-2' }), false)
})
