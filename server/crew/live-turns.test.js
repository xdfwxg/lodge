import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createLiveTurns } from './live-turns.js'
import { BusinessError } from './result.js'

const ports = createCrewPorts()

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

test('resume starts an active stage that has no evidence yet', async () => {
  const sent = []
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    workers: ['worker'],
    seatNames: { worker: 'Worker' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: 'Worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  }
  const turns = createLiveTurns({
    store: {
      ...store([]),
      readRoom: () => room,
      updateRoom: () => null,
    },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, text) => {
      sent.push([seat, text])
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'worker')
  assert.match(sent[0][1], /阶段已确认/)
})

test('resume re-requests a review that was pending before restart', async () => {
  const sent = []
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    workers: ['worker'],
    verifiers: ['verifier'],
    seatNames: { worker: 'Worker', verifier: 'Verifier' },
    seatSpecs: [
      { id: 'worker', role: 'worker', name: 'Worker' },
      { id: 'verifier', role: 'verifier', name: 'Verifier' },
    ],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
    usage: { costMicroUsd: 0, budgetMicroUsd: 5_000_000 },
  }
  const evidence = {
    id: 'e1',
    kind: 'evidence',
    seq: 1,
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0 },
  }
  const turns = createLiveTurns({
    store: {
      ...store([evidence]),
      readRoom: () => room,
      readMessages: () => [evidence],
      readRooms: () => [room],
      updateRoom: () => null,
    },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async seat => {
      sent.push(seat)
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.resume()
  assert.deepEqual(sent, ['verifier'])
})

test('resume leaves a busy room alone', async () => {
  let sent = 0
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: true,
    workers: ['worker'],
    seatNames: { worker: 'Worker' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: 'Worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  }
  const turns = createLiveTurns({
    store: { ...store([]), readRoom: () => room, updateRoom: () => null },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => {
      sent += 1
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent, 0)
})

test('turns already captured before restart are not captured again', () => {
  let appended = 0
  const turns = createLiveTurns({
    store: {
      ...store([]),
      appendMessage: () => { appended += 1 },
    },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
    commands: ports.commands,
    files: ports.files,
  })
  turns.seed([{ kind: 'evidence', meta: { turnId: 'turn-1' } }])
  turns.captureTurn({ turnId: 'turn-1', reply: 'done', toolCalls: 1 }, null)
  assert.equal(appended, 0)
})

test('a business rejection from review is a typed failure, not a system error', async () => {
  const turns = createLiveTurns({
    store: store([]),
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
    commands: ports.commands,
    files: ports.files,
  })
  await assert.rejects(
    turns.requestReview(0),
    error => error instanceof BusinessError && error.reason === 'conflict' && /证据/.test(error.message),
  )
})
