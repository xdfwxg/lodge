import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createLiveTurns } from './live-turns.js'

const ports = createCrewPorts()
import { reviewState } from './verifiers.js'

const room = (over = {}) => ({
  id: 'room-1',
  state: 'active',
  live: true,
  demo: false,
  stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
  verifiers: ['v1', 'v2'],
  seatNames: { v1: '验收一', v2: '验收二' },
  seatSpecs: [
    { id: 'v1', role: 'verifier' },
    { id: 'v2', role: 'verifier' },
  ],
  seatBots: { v1: 'bot-v1', v2: 'bot-v2' },
  workers: ['worker'],
  usage: {},
  ...over,
})

const evidence = (over = {}) => ({
  id: over.id ?? 'e-1',
  kind: 'evidence',
  seq: over.seq ?? 10,
  meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0, ...over },
})

const verdict = (authorId, pass, seq, over = {}) => ({
  id: `v-${authorId}-${seq}`,
  kind: 'verdict',
  authorId,
  seq,
  text: pass ? 'PASS\nok' : 'REJECT\nno',
  meta: { stage: 0, pass, evidenceId: 'e-1', ...over },
})

test('review state waits for every verifier, then passes only when all pass', () => {
  const base = [evidence()]
  assert.equal(reviewState({ room: room(), messages: base, stageIndex: 0 }).state, 'pending')
  const one = reviewState({ room: room(), messages: [...base, verdict('v1', true, 11)], stageIndex: 0 })
  assert.equal(one.state, 'pending')
  assert.deepEqual(one.missing, ['v2'])
  const all = reviewState({
    room: room(),
    messages: [...base, verdict('v1', true, 11), verdict('v2', true, 12)],
    stageIndex: 0,
  })
  assert.equal(all.state, 'pass')
  assert.equal(all.received, 2)
})

test('one rejection fails the round even when the other verifier passed', () => {
  const outcome = reviewState({
    room: room(),
    messages: [evidence(), verdict('v1', true, 11), verdict('v2', false, 12)],
    stageIndex: 0,
  })
  assert.equal(outcome.state, 'reject')
  assert.deepEqual(outcome.rejects.map(message => message.authorId), ['v2'])
})

test('majority quorum passes without waiting for every verifier', () => {
  const swarm = room({
    verifierPolicy: 'majority',
    verifiers: ['v1', 'v2', 'v3'],
    seatNames: { v1: '一', v2: '二', v3: '三' },
    seatSpecs: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
  })
  const base = [evidence()]
  assert.equal(reviewState({ room: swarm, messages: [...base, verdict('v1', true, 11)], stageIndex: 0 }).state, 'pending')
  const quorum = reviewState({
    room: swarm,
    messages: [...base, verdict('v1', true, 11), verdict('v2', true, 12)],
    stageIndex: 0,
  })
  assert.equal(quorum.state, 'pass')
  assert.equal(quorum.required, 2)
  const blocked = reviewState({
    room: swarm,
    messages: [...base, verdict('v1', true, 11), verdict('v2', false, 12)],
    stageIndex: 0,
  })
  assert.equal(blocked.state, 'pending')
  const lost = reviewState({
    room: swarm,
    messages: [...base, verdict('v1', false, 11), verdict('v2', false, 12)],
    stageIndex: 0,
  })
  assert.equal(lost.state, 'reject')
})

test('a human rework invalidates the earlier evidence and PASSes', () => {
  const rework = { id: 'r-1', kind: 'rework', authorId: 'you', seq: 13, meta: { stage: 0 } }
  const outcome = reviewState({
    room: room(),
    messages: [evidence(), verdict('v1', true, 11), verdict('v2', true, 12), rework],
    stageIndex: 0,
  })
  assert.equal(outcome.state, 'none')
})

test('verdicts from an older acceptance round do not count', () => {
  const outcome = reviewState({
    room: room(),
    messages: [
      evidence(),
      verdict('v1', true, 11, { evidenceId: 'old-evidence' }),
      verdict('v2', true, 12, { evidenceId: 'old-evidence' }),
    ],
    stageIndex: 0,
  })
  assert.equal(outcome.state, 'pending')
  assert.deepEqual(outcome.missing, ['v1', 'v2'])
})

test('a newer failed command invalidates earlier PASSes', () => {
  const failed = evidence({ id: 'e-2', seq: 13, exit: 1 })
  const outcome = reviewState({
    room: room(),
    messages: [
      evidence(),
      verdict('v1', true, 11),
      verdict('v2', true, 12),
      failed,
    ],
    stageIndex: 0,
  })
  assert.equal(outcome.state, 'failed')
  assert.equal(outcome.evidence.id, 'e-2')
})

test('the review request goes to every verifier and all PASS ends the round', async () => {
  const state = room()
  const messages = [evidence()]
  let seq = 11
  const store = {
    readRoom: () => state,
    readRooms: () => [],
    readMessages: () => messages,
    appendMessage: (roomId, message) => {
      const stored = { ...message, id: `m-${seq}`, seq: seq++, ts: Date.now() }
      messages.push(stored)
      return stored
    },
    appendEvent: () => {},
    updateRoom: (roomId, mutate) => {
      mutate(state)
      return state
    },
  }
  const sent = []
  const turns = createLiveTurns({
    store,
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      sent.push({ seat, prompt })
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.requestReview(0)
  assert.deepEqual(sent.map(item => item.seat), ['v1', 'v2'])
  assert.equal(turns.busyReview(), true)

  turns.captureTurn({ turnId: 't1', reply: 'PASS\nok', toolCalls: 1 }, 'bot-v1')
  assert.equal(turns.busyReview(), true)
  assert.equal(messages.filter(message => message.kind === 'verdict').length, 1)

  turns.captureTurn({ turnId: 't2', reply: 'PASS\nok', toolCalls: 1 }, 'bot-v2')
  assert.equal(turns.busyReview(), false)
  assert.equal(messages.filter(message => message.kind === 'verdict').length, 2)
  assert.match(messages.at(-1).text, /全部验收席位 PASS/)
})

test('a rejection cancels the remaining verifier round', async () => {
  const state = room()
  const messages = [evidence()]
  let seq = 11
  const store = {
    readRoom: () => state,
    readRooms: () => [],
    readMessages: () => messages,
    appendMessage: (roomId, message) => {
      const stored = { ...message, id: `m-${seq}`, seq: seq++, ts: Date.now() }
      messages.push(stored)
      return stored
    },
    appendEvent: () => {},
    updateRoom: (roomId, mutate) => {
      mutate(state)
      return state
    },
  }
  const turns = createLiveTurns({
    store,
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
    commands: ports.commands,
    files: ports.files,
  })
  await turns.requestReview(0)
  turns.captureTurn({ turnId: 't1', reply: 'REJECT\nno', toolCalls: 1 }, 'bot-v1')
  assert.equal(turns.busyReview(), false)
  assert.match(messages.at(-1).text, /其余验收席位不再等待/)
  turns.captureTurn({ turnId: 't2', reply: 'PASS\nok', toolCalls: 1 }, 'bot-v2')
  assert.equal(messages.filter(message => message.kind === 'verdict').length, 1)
})

test('a majority quorum ends the round without waiting for the last verifier', async () => {
  const state = room({
    verifierPolicy: 'majority',
    verifiers: ['v1', 'v2', 'v3'],
    seatNames: { v1: '一', v2: '二', v3: '三' },
    seatSpecs: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
    seatBots: { v1: 'bot-v1', v2: 'bot-v2', v3: 'bot-v3' },
  })
  const messages = [evidence()]
  let seq = 11
  const store = {
    readRoom: () => state,
    readRooms: () => [],
    readMessages: () => messages,
    appendMessage: (roomId, message) => {
      const stored = { ...message, id: `m-${seq}`, seq: seq++, ts: Date.now() }
      messages.push(stored)
      return stored
    },
    appendEvent: () => {},
    updateRoom: (roomId, mutate) => {
      mutate(state)
      return state
    },
  }
  const turns = createLiveTurns({
    store,
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
    commands: ports.commands,
    files: ports.files,
  })
  await turns.requestReview(0)
  turns.captureTurn({ turnId: 't1', reply: 'PASS\nok', toolCalls: 1 }, 'bot-v1')
  assert.equal(turns.busyReview(), true)
  turns.captureTurn({ turnId: 't2', reply: 'PASS\nok', toolCalls: 1 }, 'bot-v2')
  assert.equal(turns.busyReview(), false)
  assert.match(messages.at(-1).text, /quorum 达成/)
  turns.captureTurn({ turnId: 't3', reply: 'REJECT\nno', toolCalls: 1 }, 'bot-v3')
  assert.equal(messages.filter(message => message.kind === 'verdict').length, 2)
})

test('review reads credentials from the ledger, not from evidence messages', () => {
  const messages = [evidence(), verdict('v1', true, 11), verdict('v2', true, 12)]
  const withoutLedger = reviewState({ room: room(), evidence: [], messages, stageIndex: 0 })
  assert.equal(withoutLedger.state, 'none')
  const withLedger = reviewState({ room: room(), evidence: [evidence()], messages, stageIndex: 0 })
  assert.equal(withLedger.state, 'pass')
  assert.equal(withLedger.evidence.id, 'e-1')
})
