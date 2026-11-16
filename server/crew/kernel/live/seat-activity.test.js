import assert from 'node:assert/strict'
import test from 'node:test'
import { heldMessageCountsOf, heldSeatsOf, presenceOf, seatQueueOf, seatActivityOf } from './seat-activity.js'

const toSeat = ref => ({ 'bot-a': 'lead', 'bot-b': 'worker', 'bot-c': 'verifier' }[ref] ?? ref)

test('the base queue maps onto seat ids and keeps waiting order', () => {
  const queue = seatQueueOf({
    toSeat,
    queue: [
      { memberRef: 'bot-b', state: 'queued', position: 2, of: 2, waitingForRef: 'bot-a' },
      { memberRef: 'bot-a', state: 'running', position: 1, of: 2 },
    ],
  })
  assert.deepEqual(queue, [
    { seatId: 'lead', state: 'running', position: 1, of: 2 },
    { seatId: 'worker', state: 'queued', position: 2, of: 2, waitingForSeatId: 'lead' },
  ])
})

test('a seat repeated in the queue is kept once, running wins', () => {
  const queue = seatQueueOf({
    toSeat,
    queue: [
      { memberRef: 'bot-b', state: 'queued', position: 2, of: 2 },
      { memberRef: 'bot-b', state: 'running', position: 1, of: 2 },
    ],
  })
  assert.deepEqual(queue, [{ seatId: 'worker', state: 'running', position: 1, of: 2 }])
})

test('empty or unmapped queues produce nothing', () => {
  assert.deepEqual(seatQueueOf(), [])
  assert.deepEqual(seatQueueOf({ queue: [], toSeat }), [])
  assert.deepEqual(presenceOf([]), [])
})

test('presence turns running into working and keeps queued seats', () => {
  const queue = seatQueueOf({
    toSeat,
    queue: [
      { memberRef: 'bot-a', state: 'running', position: 1, of: 2 },
      { memberRef: 'bot-c', state: 'queued', position: 2, of: 2 },
    ],
  })
  assert.deepEqual(presenceOf(queue), [
    { seatId: 'lead', state: 'working' },
    { seatId: 'verifier', state: 'queued' },
  ])
})

test('the shared projection publishes the queue, presence and holds', () => {
  const out = seatActivityOf({
    queue: [
      { memberRef: 'bot-a', state: 'running', position: 1, of: 2 },
      { memberRef: 'bot-c', state: 'queued', position: 2, of: 2, waitingForRef: 'bot-a' },
    ],
    holds: { 'bot-b': { at: 1 } },
    heldMessages: { 'bot-b': [{ threadId: 't1', messageId: 'm1' }, { threadId: 't1', messageId: 'm2' }] },
  }, toSeat)
  assert.deepEqual(out.turnQueue.map(item => [item.seatId, item.state]), [['lead', 'running'], ['verifier', 'queued']])
  assert.deepEqual(out.presence, [{ seatId: 'lead', state: 'working' }, { seatId: 'verifier', state: 'queued' }])
  assert.deepEqual(out.heldSeats, ['worker'])
  assert.deepEqual(out.heldMessages, { worker: 2 })
})

test('holds map onto seats and ignore unknown members', () => {
  assert.deepEqual(heldSeatsOf({ toSeat, holds: { 'bot-a': { at: 1 }, 'bot-x': { at: 2 } } }), ['lead', 'bot-x'])
  assert.deepEqual(heldSeatsOf({ toSeat }), [])
})

test('held messages count per seat and drop empty members', () => {
  assert.deepEqual(
    heldMessageCountsOf({
      toSeat,
      heldMessages: {
        'bot-a': [{ messageId: 'm1' }],
        'bot-b': [],
        'bot-x': [{ messageId: 'm2' }],
      },
    }),
    { lead: 1, 'bot-x': 1 },
  )
})
