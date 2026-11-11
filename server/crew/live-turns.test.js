import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveTurns } from './live-turns.js'
import { BusinessError } from './result.js'

const store = messages => ({
  readRoom: () => ({
    id: 'room-1',
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
    verifiers: ['verifier'],
    seatNames: { verifier: 'Verifier' },
    seatRooms: {},
  }),
  readMessages: () => messages,
  readRooms: () => [],
  updateRoom: () => null,
  appendEvent: () => {},
  appendMessage: () => {},
})

test('a business rejection from review is a typed failure, not a system error', async () => {
  const turns = createLiveTurns({
    store: store([]),
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
  })
  await assert.rejects(
    turns.requestReview(0),
    error => error instanceof BusinessError && error.reason === 'conflict' && /证据/.test(error.message),
  )
})
