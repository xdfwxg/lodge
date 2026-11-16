import assert from 'node:assert/strict'
import test from 'node:test'
import { createBodySwap } from './body-swap.js'

const member = (id, role, engine) => ({
  id,
  name: { lead: '规划师', worker: '执行官', verifier: '验收员' }[id],
  role,
  roleKind: role,
  station: '工位',
  approval: 'ask',
  permissions: { read: true, exec: role !== 'lead', write: role !== 'lead' },
  body: { kind: 'base', ref: `bot-${id}`, roomRef: `base-${id}`, sessionRef: `thread-${id}`, engine, model: 'old-model' },
  prompt: `你是${id}`,
})

const roomOf = () => ({
  id: 'room-1',
  name: '房间',
  goal: '做事',
  roomType: 'studio',
  state: 'paused',
  live: true,
  verify: 'test',
  acceptance: 'test -f a',
  chatRoom: { id: 'shared' },
  chatHost: { memberRef: 'host' },
  repoPath: '/tmp/room',
  worktrees: { worker: '/tmp/worker' },
  members: [member('lead', 'lead', 'claude'), member('worker', 'worker', 'pi'), member('verifier', 'verifier', 'pi')],
  engines: { lead: 'claude', worker: 'pi', verifier: 'pi' },
  models: { lead: 'sonnet', worker: 'old-model', verifier: 'old-model' },
  independence: 'none',
  pauseReason: 'member_error',
  memberError: { memberId: 'worker', kind: 'auth' },
  presence: [],
  turnQueue: [],
  approvals: [],
})

const harness = ({ authenticated } = {}) => {
  let room = roomOf()
  const calls = { created: [], shared: [], deleted: [], messages: [], events: [], detached: [], attached: [] }
  const store = {
    readRoom: () => room,
    updateRoom: (_id, mutator) => {
      const next = mutator(room)
      if (next !== null && Array.isArray(next.events)) calls.events.push(...next.events)
      return room
    },
    appendMessage: (_id, message) => calls.messages.push(message),
  }
  const engine = {
    instances: async () => [
      { id: 'claude', engine: 'claude', name: 'Claude', available: true, ...(authenticated === undefined ? {} : { authenticated }), capabilities: { approvalReview: true } },
      { id: 'pi', engine: 'pi', name: 'Pi', available: true, capabilities: { approvalReview: false } },
    ],
    createMemberBot: async input => {
      calls.created.push(input)
      return { id: 'bot-new', name: input.name, engine: 'claude', model: input.model ?? 'sonnet' }
    },
    createRoom: async input => ({ id: 'base-new', sessionRef: 'thread-new', input }),
    updateRoomMembers: async (id, members) => calls.shared.push({ id, members }),
    deleteRoom: async id => calls.deleted.push({ room: id }),
    deleteMemberBot: async id => calls.deleted.push({ bot: id }),
  }
  const swap = createBodySwap({
    store,
    engine,
    emit: () => {},
    attachMember: async (_roomId, memberId) => calls.attached.push(memberId),
    detachMember: (_roomId, memberId) => calls.detached.push(memberId),
  })
  return { swap, calls, get room() { return room } }
}

test('swapping keeps the member and its history, and replaces the body', async () => {
  const { swap, calls, room } = harness()
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, true, result.error)
  const worker = room.members.find(item => item.id === 'worker')
  assert.equal(worker.body.ref, 'bot-new')
  assert.equal(worker.body.roomRef, 'base-new')
  assert.equal(worker.body.sessionRef, 'thread-new')
  assert.equal(worker.body.engine, 'claude')
  assert.equal(worker.body.model, 'sonnet')
  assert.equal(room.engines.worker, 'claude')
  assert.equal(room.models.worker, 'sonnet')
  assert.equal(room.state, 'active')
  assert.equal(room.pauseReason, null)
  assert.equal(room.memberError, undefined)
  assert.equal(room.independence, 'vendor')
  assert.deepEqual(calls.detached, ['worker'])
  assert.deepEqual(calls.attached, ['worker'])
  assert.ok(calls.shared.some(call => call.members.includes('bot-new') && !call.members.includes('bot-worker')))
  assert.ok(calls.deleted.some(item => item.room === 'base-worker'))
  assert.ok(calls.deleted.some(item => item.bot === 'bot-worker'))
  assert.match(calls.messages.at(-1).text, /换好了身体/)
  assert.equal(calls.events.some(event => event.type === 'member.body.swapped'), true)
  assert.match(calls.created[0].soul, /你是worker/)
})

test('a model that never asks cannot become the body of an exec member', async () => {
  const { swap, calls } = harness()
  const result = await swap.swap(roomOf(), { memberId: 'worker', engine: 'pi', model: 'other-model' })
  assert.equal(result.ok, false)
  assert.match(result.error, /不会先问你/)
  assert.equal(calls.created.length, 0)
})

test('a logged-out model cannot become the new body', async () => {
  const { swap, calls } = harness({ authenticated: false })
  const result = await swap.swap(roomOf(), { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /没有登录/)
  assert.equal(calls.created.length, 0)
})

test('a busy room keeps its body until the turn ends', async () => {
  const { swap, calls } = harness()
  const room = roomOf()
  room.busy = true
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /等这一回合结束/)
  assert.equal(calls.created.length, 0)
})

test('a pending approval blocks the swap', async () => {
  const { swap, calls } = harness()
  const room = roomOf()
  room.approvals = [{ id: 'a1', memberId: 'worker', state: 'pending' }]
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /待确认/)
  assert.equal(calls.created.length, 0)
})
