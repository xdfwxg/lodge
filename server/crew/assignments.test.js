import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssignment, transitionAssignment } from './assignments.js'
import { dispatchFrom, tasksFrom } from './assignment-projections.js'
import { compactRoom, pageAssignments } from './assignment-history.js'
import { withAssignments } from './testing/room.js'

const makeStore = (room, messages = []) => {
  const writes = []
  const store = withAssignments({
    readRooms: () => [room],
    readRoom: () => room,
    readMessages: () => messages,
    upsertMessage: message => {
      const index = messages.findIndex(item => item.id === message.id)
      if (index >= 0) messages[index] = message
    },
    writeRoom: value => writes.push(value.id),
  })
  return { store, messages, writes }
}

test('each new handoff to the same member is a new attempt', () => {
  const room = {
    id: 'room-1',
    members: [{ id: 'lead' }, { id: 'worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active' }],
  }
  const { store } = makeStore(room)
  const first = createAssignment({ store, roomId: 'room-1', stageIndex: 0, fromMemberId: 'lead', toMemberId: 'worker' })
  const second = createAssignment({ store, roomId: 'room-1', stageIndex: 0, fromMemberId: 'lead', toMemberId: 'worker', reason: 'rework' })
  assert.equal(first.attempt, 1)
  assert.equal(second.attempt, 2)
})

test('an assignment id cannot be reused by another room', () => {
  const { store } = makeStore({ id: 'room-1', members: [{ id: 'lead' }, { id: 'worker' }], stages: [] })
  createAssignment({ store, roomId: 'room-1', stageIndex: 0, fromMemberId: 'lead', toMemberId: 'worker', id: 'as-shared' })
  assert.throws(() => createAssignment({
    store,
    roomId: 'room-2',
    stageIndex: 0,
    fromMemberId: 'lead',
    toMemberId: 'worker',
    id: 'as-shared',
  }), /另一个房间/)
  assert.equal(store.readAssignment('as-shared', 'room-2'), null)
})

test('a sent branch carries a lease and releases it when it reports', () => {
  const room = {
    id: 'room-1',
    members: [{ id: 'lead' }, { id: 'worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active' }],
  }
  const { store } = makeStore(room)
  const assignment = createAssignment({ store, roomId: 'room-1', stageIndex: 0, fromMemberId: 'lead', toMemberId: 'worker' })
  assert.equal(assignment.lease, null)
  const lease = { token: 'lease-1', at: 10, expiresAt: 20 }
  transitionAssignment(store, assignment.id, 'sent', { lease })
  assert.equal(store.readAssignment(assignment.id).lease.token, 'lease-1')
  transitionAssignment(store, assignment.id, 'reported')
  assert.equal(store.readAssignment(assignment.id).lease, null)
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
  assert.equal(compactRoom(store, 'room-1', { keep: 2 }), 3)
  assert.deepEqual(store.readAssignments('room-1').map(item => item.id), ['as-4', 'as-5', 'as-open'])
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

test('assignment targets are explicit and stay inside the room', () => {
  const { store } = makeStore({ id: 'room-1', stages: [], members: [{ id: 'worker' }] })
  assert.throws(
    () => createAssignment({ store, roomId: 'room-1', stageIndex: 0, toMemberId: 'ghost' }),
    /不在房间/,
  )
  assert.throws(
    () => createAssignment({ store, roomId: 'room-1', stageIndex: 0, toMemberId: null, reason: 'subroom' }),
    /需要一个子房/,
  )
  const child = createAssignment({
    store,
    roomId: 'room-1',
    stageIndex: 0,
    toMemberId: null,
    toRoomId: 'child',
    reason: 'subroom',
  })
  assert.equal(child.toRoomId, 'child')
})
