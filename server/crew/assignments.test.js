import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchFrom, migrateAssignments, tasksFrom } from './assignments.js'
import { withAssignments } from './testing/room.js'

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
