import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceSubrooms } from './rooms/studio/service-subrooms.js'
import { withAssignments } from './testing/room.js'

test('a subroom is created as a studio and its handoff lives in the parent room', async () => {
  const calls = []
  const parent = {
    id: 'parent',
    roomType: 'studio',
    state: 'active',
    depth: 0,
    leadMemberId: 'lead',
    members: [{ id: 'lead', name: 'Lead', role: 'lead' }],
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
  }
  const child = { id: 'child', name: '子任务', leadMemberId: 'worker', depth: 1 }
  const store = withAssignments({
    readRoom: id => (id === 'parent' ? parent : null),
    updateRoom: (id, mutate) => {
      if (id !== 'child') return null
      mutate(child)
      return child
    },
    appendEvent: () => {},
  })
  const service = createServiceSubrooms({
    store,
    createRoom: async (body, target) => {
      calls.push({ body, parent: target })
      return { ok: true, body: { room: child } }
    },
  })
  const result = await service.create(parent, { goal: '子任务', roomType: 'chat' })
  assert.equal(result.ok, true)
  assert.equal(calls[0].body.roomType, 'studio')
  assert.equal(calls[0].body.verify, 'manual')
  assert.equal(calls[0].parent, parent)
  const [assignment] = store.readAssignments('parent')
  assert.equal(assignment.reason, 'subroom')
  assert.equal(assignment.status, 'sent')
  assert.equal(assignment.stageIndex, 0)
  assert.equal(assignment.context.childRoomId, 'child')
  assert.equal(child.parentAssignmentId, assignment.id)
  assert.equal(result.body.room.parentAssignmentId, assignment.id)
})

test('chat and depth-limited studios cannot create subrooms', async () => {
  const service = createServiceSubrooms({ createRoom: async () => ({ ok: true }) })
  const chat = await service.create({ roomType: 'chat', state: 'active', depth: 0 }, { goal: 'x' })
  assert.equal(chat.ok, false)
  const deep = await service.create({ roomType: 'studio', state: 'active', depth: 3 }, { goal: 'x' })
  assert.equal(deep.ok, false)
  const empty = await service.create({ roomType: 'studio', state: 'active', depth: 0 }, { goal: '  ' })
  assert.equal(empty.ok, false)
})
