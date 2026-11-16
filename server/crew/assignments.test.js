import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssignment, dispatchFrom, migrateAssignments, pageAssignments, tasksFrom, transitionAssignment } from './assignments.js'
import { withAssignments } from './testing/room.js'
import { settleCompletedSubrooms } from './rooms/studio/subrooms.js'

const makeStore = (room, messages = []) => {
  const writes = []
  const store = withAssignments({
    readRooms: () => [room],
    readMessages: () => messages,
    upsertMessage: message => {
      const index = messages.findIndex(item => item.id === message.id)
      if (index >= 0) messages[index] = message
    },
    writeRoom: value => writes.push(value.id),
  })
  return { store, messages, writes }
}

test('handoff messages become assignments and keep only the assignment reference', () => {
  const room = { id: 'room-1', stages: [{ title: 'impl', kind: 'deliverable', state: 'active' }] }
  const messages = [{
    id: 'm1',
    kind: 'handoff',
    ts: 100,
    meta: {
      stage: 0,
      from: 'lead',
      to: 'worker',
      reason: 'dispatch',
      status: 'sent',
      deliveryId: 'h-1',
      workTurn: { done: ['测试通过'], acceptance: 'npm test', evidence: { id: 'e1', text: 'ok' } },
    },
  }]
  const { store, messages: stored } = makeStore(room, messages)
  assert.equal(migrateAssignments(store), 1)
  const [assignment] = store.readAssignments('room-1')
  assert.equal(assignment.id, 'as-h-1')
  assert.equal(assignment.toMemberId, 'worker')
  assert.equal(assignment.status, 'sent')
  assert.equal(assignment.brief.done[0], '测试通过')
  assert.deepEqual(assignment.evidenceIds, ['e1'])
  assert.deepEqual(stored[0].meta, { assignmentId: 'as-h-1', stage: 0, status: 'sent' })
})

test('stageDispatch and stage tasks become assignments and leave the room', () => {
  const room = {
    id: 'room-1',
    leadMemberId: 'lead',
    stages: [{
      title: 'impl',
      kind: 'deliverable',
      state: 'active',
      acceptance: 'npm test',
      tasks: [{ owner: 'w1', status: 'done', evidenceRef: 'e1' }],
    }],
    stageDispatch: { stage: 0, workers: ['w1', 'w2'], pending: ['w2'], failed: [], base: 'base', startedAt: 50 },
  }
  const { store, writes } = makeStore(room)
  assert.equal(migrateAssignments(store), 2)
  const rows = store.readAssignments('room-1')
  assert.deepEqual(rows.map(item => item.toMemberId).sort(), ['w1', 'w2'])
  assert.equal(rows.find(item => item.toMemberId === 'w2').status, 'sent')
  assert.equal(room.stageDispatch, undefined)
  assert.equal(room.stages[0].tasks, undefined)
  assert.equal(writes.length, 1)
})

test('migration is idempotent and does not duplicate a stage member', () => {
  const room = {
    id: 'room-1',
    stages: [{
      title: 'impl',
      kind: 'deliverable',
      state: 'active',
      tasks: [{ owner: 'w1', status: 'working' }],
    }],
  }
  const { store } = makeStore(room)
  const first = migrateAssignments(store)
  const afterFirst = store.readAssignments('room-1').length
  const second = migrateAssignments(store)
  assert.equal(first, 1)
  assert.equal(second, 0)
  assert.equal(store.readAssignments('room-1').length, afterFirst)
})

test('dispatch and tasks project from assignments without the room', () => {
  const assignments = [
    { id: 'a1', stageIndex: 0, toMemberId: 'w1', reason: 'dispatch', status: 'reported', context: { base: 'base' }, flags: { integrated: true }, createdAt: 1 },
    { id: 'a2', stageIndex: 0, toMemberId: 'w2', reason: 'dispatch', status: 'working', context: { base: 'base' }, flags: {}, createdAt: 2 },
  ]
  const dispatch = dispatchFrom(assignments, 0)
  assert.deepEqual(dispatch.workers, ['w1', 'w2'])
  assert.deepEqual(dispatch.pending, ['w2'])
  assert.equal(dispatch.base, 'base')
  assert.equal(dispatch.integrated, false)
  const tasks = tasksFrom(assignments, 0, id => id.toUpperCase())
  assert.deepEqual(tasks.map(task => [task.title, task.status]), [['W1', 'reported'], ['W2', 'working']])
})

const seed = (store, over) => store.writeAssignment({
  id: 'as-1',
  roomId: 'room-1',
  stageIndex: 0,
  fromMemberId: 'lead',
  toMemberId: 'worker',
  reason: 'dispatch',
  brief: {},
  status: 'sent',
  context: {},
  flags: {},
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

test('assignment status only moves along the declared transitions', () => {
  const { store } = makeStore({ id: 'room-1', stages: [] })
  seed(store)
  assert.equal(transitionAssignment(store, 'as-1', 'reported').status, 'reported')
  assert.equal(transitionAssignment(store, 'as-1', 'passed').status, 'passed')
  assert.equal(transitionAssignment(store, 'as-1', 'sent'), null)
  assert.equal(store.readAssignment('as-1').status, 'passed')
  assert.equal(transitionAssignment(store, 'missing', 'sent'), null)
})

test('assignment history pages from newest to oldest with a cursor', () => {
  const { store } = makeStore({ id: 'room-1', stages: [] })
  for (let at = 1; at <= 5; at += 1) seed(store, { id: `as-${at}`, createdAt: at })
  const first = pageAssignments(store, 'room-1', { limit: 2 })
  assert.deepEqual(first.items.map(item => item.id), ['as-4', 'as-5'])
  assert.equal(first.hasMore, true)
  assert.equal(first.next, 'as-4')
  const second = pageAssignments(store, 'room-1', { limit: 2, before: first.next })
  assert.deepEqual(second.items.map(item => item.id), ['as-2', 'as-3'])
  assert.equal(second.next, 'as-2')
  const last = pageAssignments(store, 'room-1', { limit: 2, before: second.next })
  assert.deepEqual(last.items.map(item => item.id), ['as-1'])
  assert.equal(last.hasMore, false)
  assert.equal(last.next, null)
})

test('pruning keeps open work and the newest terminal assignments', () => {
  const { store } = makeStore({ id: 'room-1', stages: [] })
  for (let at = 1; at <= 5; at += 1) seed(store, { id: `as-${at}`, status: 'passed', createdAt: at })
  seed(store, { id: 'as-open', status: 'sent', createdAt: 6 })
  assert.equal(store.pruneAssignments('room-1', { keep: 2 }), 3)
  assert.deepEqual(store.readAssignments('room-1').map(item => item.id), ['as-4', 'as-5', 'as-open'])
})

test('a completed subroom settles its parent assignment once', () => {
  const parent = { id: 'parent', childRoomIds: ['child'], members: [{ id: 'lead', name: 'Lead' }] }
  const child = { id: 'child', name: 'Child', state: 'complete', parentAssignmentId: 'as-child' }
  const verdict = {
    id: 'v1',
    kind: 'verdict',
    authorId: 'verifier',
    text: 'PASS\n测试通过',
    meta: { pass: true, roleKind: 'verifier', stage: 0 },
  }
  const store = withAssignments({
    readRoom: id => (id === 'parent' ? parent : id === 'child' ? child : null),
    readMessages: id => (id === 'child' ? [verdict] : []),
  })
  seed(store, { id: 'as-child', reason: 'subroom', toMemberId: null, status: 'sent' })
  assert.equal(settleCompletedSubrooms(store, 'parent'), 1)
  const settled = store.readAssignment('as-child')
  assert.equal(settled.status, 'passed')
  assert.deepEqual(settled.evidenceIds, ['v1'])
  assert.match(settled.resultText, /Child/)
  assert.equal(settleCompletedSubrooms(store, 'parent'), 0)
})

test('creating an existing assignment again never overwrites its result', () => {
  const { store } = makeStore({ id: 'room-1', stages: [] })
  const first = createAssignment({
    store,
    id: 'as-fixed',
    roomId: 'room-1',
    stageIndex: 0,
    toMemberId: 'worker',
    evidenceIds: ['e1'],
  })
  store.updateAssignment('as-fixed', assignment => {
    assignment.status = 'reported'
    assignment.resultText = 'done'
    return true
  })
  const second = createAssignment({
    store,
    id: 'as-fixed',
    roomId: 'room-1',
    stageIndex: 0,
    toMemberId: 'worker',
  })
  assert.equal(second.id, first.id)
  const stored = store.readAssignment('as-fixed')
  assert.equal(stored.status, 'reported')
  assert.equal(stored.resultText, 'done')
  assert.deepEqual(stored.evidenceIds, ['e1'])
})
