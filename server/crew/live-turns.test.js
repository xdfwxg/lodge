import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createLiveTurns } from './rooms/studio/turns.js'
import { BusinessError } from './result.js'
import { normalizeTestRoom, withAssignments } from './testing/room.js'

const ports = createCrewPorts()

const store = messages => withAssignments({
  readRoom: () => normalizeTestRoom({
    id: 'room-1',
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
    seatSpecs: [{ id: 'verifier', role: 'verifier', name: 'Verifier' }],
    seatNames: { verifier: 'Verifier' },
    seatRooms: {},
  }),
  readMessages: () => messages,
  readRooms: () => [],
  updateRoom: () => null,
  appendEvent: () => {},
  appendMessage: (roomId, message) => ({ ...message, id: 'm-handoff', seq: 1 }),
})

test('resume starts an active stage by waking the executor', async () => {
  const sent = []
  const room = normalizeTestRoom({
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    leadSeat: 'planner',
    members: ['planner', 'worker'],
    workers: ['worker'],
    seatNames: { planner: 'Planner', worker: 'Worker' },
    seatSpecs: [
      { id: 'planner', role: 'lead', name: 'Planner' },
      { id: 'worker', role: 'worker', name: 'Worker' },
    ],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  })
  const turns = createLiveTurns({
    store: {
      ...store([]),
      readRoom: () => room,
      updateRoom: () => null,
    },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (member, text) => {
      sent.push([member, text])
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'worker')
  assert.match(sent[0][1], /阶段 1「impl」已确认/)
})

test('resume re-requests a review that was pending before restart', async () => {
  const sent = []
  const room = normalizeTestRoom({
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
  })
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
    sendToMember: async member => {
      sent.push(member)
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
  const room = normalizeTestRoom({
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busyMembers: ['worker'],
    workers: ['worker'],
    seatNames: { worker: 'Worker' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: 'Worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  })
  const turns = createLiveTurns({
    store: { ...store([]), readRoom: () => room, updateRoom: () => null },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => {
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
    sendToMember: async () => ({ messageId: null }),
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
    sendToMember: async () => ({ messageId: null }),
    commands: ports.commands,
    files: ports.files,
  })
  await assert.rejects(
    turns.requestReview(0),
    error => error instanceof BusinessError && error.reason === 'conflict' && /证据/.test(error.message),
  )
})

test('resume wakes only the assignments that have not reported', async () => {
  const sent = []
  const room = normalizeTestRoom({
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    leadSeat: 'planner',
    members: ['planner', 'w1', 'w2'],
    workers: ['w1', 'w2'],
    seatNames: { planner: 'Planner', w1: 'W1', w2: 'W2' },
    seatSpecs: [
      { id: 'planner', role: 'lead', name: 'Planner' },
      { id: 'w1', role: 'worker', name: 'W1' },
      { id: 'w2', role: 'worker', name: 'W2' },
    ],
    orchestration: 'parallel',
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  })
  const evidence = {
    id: 'e1',
    kind: 'evidence',
    authorId: 'w1',
    seq: 1,
    meta: { stage: 0, kind: 'turn', turnId: 't1' },
  }
  const base = withAssignments({
    readRoom: () => room,
    readMessages: () => [evidence],
    readRooms: () => [room],
    updateRoom: () => null,
    appendEvent: () => {},
    appendMessage: (roomId, message) => ({ ...message, id: 'm-handoff', seq: 2 }),
  })
  for (const worker of ['w1', 'w2']) {
    base.writeAssignment({
      id: `as-${worker}`,
      roomId: 'room-1',
      stageIndex: 0,
      fromMemberId: 'planner',
      toMemberId: worker,
      reason: 'dispatch',
      brief: {},
      status: 'sent',
      context: { parallel: true },
      flags: {},
      createdAt: 1,
      updatedAt: 1,
    })
  }
  const turns = createLiveTurns({
    store: base,
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (member, text) => {
      sent.push([member, text])
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.resume()
  assert.deepEqual(sent.map(item => item[0]), ['w2'])
  assert.match(sent[0][1], /阶段 1「impl」已确认/)
})

test('resume does not dispatch a step the planner handed to the human', async () => {
  let sent = 0
  const room = normalizeTestRoom({
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    workers: ['worker'],
    seatNames: { worker: 'Worker' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: 'Worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
    lastPlannerDecision: { stage: 0, kind: 'human', verdictId: 'v1' },
  })
  const turns = createLiveTurns({
    store: { ...store([]), readRoom: () => room, updateRoom: () => null },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => {
      sent += 1
      return { messageId: null }
    },
    commands: ports.commands,
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent, 0)
})
