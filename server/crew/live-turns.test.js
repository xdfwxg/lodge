import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createLiveTurns } from './rooms/studio/runtime/turns.js'
import { BusinessError } from './result.js'
import { withAssignments } from './testing/room.js'

const ports = createCrewPorts()

const store = messages => withAssignments({
  readRoom: () => ({
    id: 'room-1',
    roomType: 'studio',
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
    members: [
      { "id": "verifier", "role": "verifier", "name": "Verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
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
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    leadMemberId: 'planner',
    members: ['planner', 'worker'],
    workers: ['worker'],
    members: [
      { "id": "planner", "role": "lead", "name": "Planner", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "worker", "role": "worker", "name": "Worker", "roleKind": "executor", body: {"kind":"base","name":"Worker"} },
    ],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
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
    sendToMember: async (member, text) => {
      sent.push([member, text])
      return { messageId: null }
    },
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], 'worker')
  assert.match(sent[0][1], /这一步要交付：ship it/)
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
    members: [
      { "id": "worker", "role": "worker", "name": "Worker", "roleKind": "executor", body: {"kind":"base","name":"Worker"} },
      { "id": "verifier", "role": "verifier", "name": "Verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
    usage: { costMicroUsd: 0, budgetMicroUsd: 5_000_000 },
  }
  const evidence = {
    id: 'e1',
    roomType: 'studio',
    kind: 'evidence',
    seq: 1,
    meta: { stage: 0, kind: 'result' },
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
    files: ports.files,
  })
  await turns.resume()
  assert.deepEqual(sent, ['verifier'])
})

test('resume re-requests a manual review that was pending before restart', async () => {
  const sent = []
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    workers: ['worker'],
    verifiers: ['verifier'],
    members: [
      { "id": "worker", "role": "worker", "name": "Worker", "roleKind": "executor", body: {"kind":"base","name":"Worker"} },
      { "id": "verifier", "role": "verifier", "name": "Verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
    stages: [{ title: 'artifact', kind: 'deliverable', state: 'active', deliverable: '一份结果' }],
  }
  const evidence = {
    id: 'e-manual',
    roomType: 'studio',
    kind: 'evidence',
    seq: 1,
    meta: { stage: 0, kind: 'result' },
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
    busyMembers: ['worker'],
    workers: ['worker'],
    members: [
      { "id": "worker", "role": "worker", "name": "Worker", "roleKind": "executor", body: {"kind":"base","name":"Worker"} },
    ],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
  }
  const turns = createLiveTurns({
    store: { ...store([]), readRoom: () => room, updateRoom: () => null },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => {
      sent += 1
      return { messageId: null }
    },
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent, 0)
})

test('turns already captured before restart are not captured again', async () => {
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
    files: ports.files,
  })
  turns.seed([{ kind: 'evidence', meta: { turnId: 'turn-1' } }])
  await turns.captureTurn({ turnId: 'turn-1', reply: 'done', toolCalls: 1 }, null)
  assert.equal(appended, 0)
})

test('a business rejection from review is a typed failure, not a system error', async () => {
  const base = store([])
  const room = { ...base.readRoom(), state: 'active', activeRoundId: 'round-1' }
  const turns = createLiveTurns({
    store: { ...base, readRoom: () => room },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    files: ports.files,
  })
  await assert.rejects(
    turns.requestReview(0),
    error => error instanceof BusinessError && error.reason === 'conflict' && /证据/.test(error.message),
  )
})

test('resume wakes only the assignments that have not reported', async () => {
  const sent = []
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    leadMemberId: 'planner',
    members: ['planner', 'w1', 'w2'],
    workers: ['w1', 'w2'],
    members: [
      { "id": "planner", "role": "lead", "name": "Planner", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "w1", "role": "worker", "name": "W1", "roleKind": "executor", body: {"kind":"base","name":"W1"} },
      { "id": "w2", "role": "worker", "name": "W2", "roleKind": "executor", body: {"kind":"base","name":"W2"} },
    ],
    orchestration: 'parallel',
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
  }
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
    files: ports.files,
  })
  await turns.resume()
  assert.deepEqual(sent.map(item => item[0]), ['w2'])
  assert.match(sent[0][1], /这一步要交付：ship it/)
})

test('resume does not dispatch a step the planner handed to the human', async () => {
  let sent = 0
  const room = {
    ...store([]).readRoom(),
    live: true,
    state: 'active',
    busy: false,
    workers: ['worker'],
    members: [
      { "id": "worker", "role": "worker", "name": "Worker", "roleKind": "executor", body: {"kind":"base","name":"Worker"} },
    ],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
    lastPlannerDecision: { stage: 0, kind: 'human', verdictId: 'v1' },
  }
  const turns = createLiveTurns({
    store: { ...store([]), readRoom: () => room, updateRoom: () => null },
    engine: {},
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => {
      sent += 1
      return { messageId: null }
    },
    files: ports.files,
  })
  await turns.resume()
  assert.equal(sent, 0)
})
