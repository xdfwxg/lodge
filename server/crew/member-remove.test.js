import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemberRemove } from './member-remove.js'

const member = (id, role, engine) => ({
  id,
  name: { lead: '规划师', worker: '执行官', verifier: '验收员' }[id],
  role,
  roleKind: role === 'worker' ? 'executor' : role,
  permissions: { read: true, exec: role !== 'lead', write: role === 'worker' },
  body: { ref: `bot-${id}`, roomRef: `base-${id}`, sessionRef: `thread-${id}`, engine, model: 'm' },
})

const roomOf = () => ({
  id: 'room-x',
  name: '房间',
  goal: '做事',
  roomType: 'studio',
  state: 'active',
  live: true,
  chatRoom: { id: 'shared' },
  chatHost: null,
  worktrees: { lead: '/wt/lead', worker: '/wt/worker', verifier: '/wt/verifier' },
  branches: { worker: 'crew/x/worker' },
  ports: { worker: 4000 },
  workspaceEnv: { worker: {} },
  members: [member('lead', 'lead', 'claude'), member('worker', 'worker', 'pi'), member('verifier', 'verifier', 'claude')],
  independence: 'none',
  turnQueue: [],
  approvals: [],
})

const harness = ({ assignments = [] } = {}) => {
  let room = roomOf()
  const calls = { shared: [], retired: [], removed: [], messages: [], events: [], detached: [] }
  const store = {
    readRoom: () => room,
    readAssignments: () => assignments,
    updateRoom: (_id, mutator) => {
      const next = mutator(room)
      if (next !== null && Array.isArray(next.events)) calls.events.push(...next.events)
      return room
    },
    appendMessage: (_id, message) => calls.messages.push(message),
  }
  const engine = {
    instances: async () => [
      { id: 'claude', engine: 'claude', available: true, authenticated: true, capabilities: { approvalReview: true } },
      { id: 'pi', engine: 'pi', available: true, authenticated: true, capabilities: { approvalReview: false } },
    ],
    updateRoomMembers: async (id, refs) => calls.shared.push({ id, refs }),
    deleteRoom: async id => calls.retired.push(id),
    deleteMemberBot: async id => calls.retired.push(id),
  }
  const workspace = {
    provider: () => ({
      removeMember: ({ member: spec }) => calls.removed.push(spec.id),
    }),
  }
  const remove = createMemberRemove({
    store,
    engine,
    emit: () => {},
    workspace,
    detachMember: (_roomId, memberId) => calls.detached.push(memberId),
  })
  return { remove, calls, get room() { return room } }
}

test('removing a member retires the body and keeps its name for history', async () => {
  const { remove, calls, room } = harness()
  const result = await remove.remove(room, { memberId: 'worker' })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(room.members.map(item => item.id), ['lead', 'verifier'])
  assert.equal(room.worktrees.worker, undefined)
  assert.equal(room.removedMembers.worker.name, '执行官')
  assert.ok(calls.shared.some(call => call.refs.includes('bot-lead') && !call.refs.includes('bot-worker')))
  assert.ok(calls.retired.includes('base-worker'))
  assert.ok(calls.retired.includes('bot-worker'))
  assert.deepEqual(calls.removed, ['worker'])
  assert.deepEqual(calls.detached, ['worker'])
  assert.match(calls.messages.at(-1).text, /把执行官移出了房间；历史还在/)
  assert.equal(calls.events.some(event => event.type === 'member.removed'), true)
  assert.equal(room.independence, 'vendor')
})

test('the main bot cannot be removed', async () => {
  const { remove, calls } = harness()
  const result = await remove.remove(roomOf(), { memberId: 'lead' })
  assert.equal(result.ok, false)
  assert.match(result.error, /规划师不能移除/)
  assert.equal(calls.retired.length, 0)
})

test('an unfinished handoff keeps the member in the room', async () => {
  const { remove, calls } = harness({
    assignments: [{ id: 'a1', status: 'sent', toMemberId: 'worker', fromMemberId: 'lead' }],
  })
  const result = await remove.remove(roomOf(), { memberId: 'worker' })
  assert.equal(result.ok, false)
  assert.match(result.error, /没结束的交接/)
  assert.equal(calls.retired.length, 0)
})

test('a chat room cannot remove a member while someone is speaking', async () => {
  const { remove, calls } = harness()
  const room = roomOf()
  room.chat = { running: true }
  const result = await remove.remove(room, { memberId: 'worker' })
  assert.equal(result.ok, false)
  assert.match(result.error, /等这一回合结束/)
  assert.equal(calls.retired.length, 0)
})

test('a busy room waits before removing anyone', async () => {
  const { remove, calls } = harness()
  const room = roomOf()
  room.busyMembers = ['worker']
  const result = await remove.remove(room, { memberId: 'worker' })
  assert.equal(result.ok, false)
  assert.match(result.error, /等这一回合结束/)
  assert.equal(calls.retired.length, 0)
})
