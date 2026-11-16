import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createCrewService } from './service.js'

const roomRecord = (overrides = {}) => ({
  id: 'r1',
  kind: 'room',
  name: '旧名字',
  goal: 'g',
  state: 'active',
  live: false,
  stages: [],
  members: [],
  childRoomIds: [],
  ...overrides,
})

const setup = (room, liveOverrides = {}) => {
  let current = room
  const emitted = []
  const removedPaths = []
  let deleted = null
  const store = {
    readRoom: () => current,
    readRooms: () => (current === null ? [] : [current]),
    readMessages: () => [],
    readMessagesSince: () => [],
    writeRoom: () => {},
    updateRoom: (id, mutate) => {
      const next = { ...current }
      const change = mutate(next)
      if (change === null || change === undefined || change === false) return null
      current = next
      return next
    },
    deleteRoom: id => {
      deleted = id
      current = null
      return true
    },
    appendMessage: () => ({}),
    appendEvent: () => {},
  }
  const ports = createCrewPorts()
  ports.files = { ...ports.files, remove: path => removedPaths.push(path) }
  const service = createCrewService({
    store,
    engine: { health: async () => ({}), instances: async () => [] },
    live: { isAttached: () => false, detach: () => {}, ...liveOverrides },
    emit: (event, payload) => emitted.push([event, payload]),
    roles: [],
    ports,
  })
  return { service, emitted, removedPaths, deleted: () => deleted }
}

const post = body => ({ method: 'POST', readBody: async () => body })

test('renaming a room updates its name and emits the room', async () => {
  const ctx = setup(roomRecord())
  const result = await ctx.service.roomRequest('r1', 'rename', post({ name: '新名字' }))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.name, '新名字')
  assert.equal(ctx.emitted.some(([event]) => event === 'room'), true)
})

test('archiving an active room stops it without a running engine', async () => {
  const ctx = setup(roomRecord())
  const result = await ctx.service.roomRequest('r1', 'archive', post({}))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.state, 'stopped')
  assert.equal(result.body.room.live, false)
  assert.equal(typeof result.body.room.archivedAt, 'number')
})

test('restoring a room clears the archive marker', async () => {
  const ctx = setup(roomRecord({ archivedAt: 1, state: 'complete' }))
  const result = await ctx.service.roomRequest('r1', 'archive', post({ archived: false }))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.archivedAt, null)
})

test('holding a member goes through the live runtime', async () => {
  const calls = []
  const ctx = setup(roomRecord({
    live: true,
    members: [{ id: 'worker', name: '执行官', body: { kind: 'base', ref: 'member-1', name: '执行官' } }],
    chatRoom: { id: 'chat-1' },
  }), {
    isAttached: () => true,
    holdMember: async (roomId, memberId, held) => {
      calls.push({ roomId, memberId, held })
      return roomRecord({ live: true, members: [{ id: 'worker', name: '执行官', body: { kind: 'base', ref: 'member-1', name: '执行官' } }], heldMembers: held ? [memberId] : [] })
    },
  })
  const result = await ctx.service.roomRequest('r1', 'hold', post({ memberId: 'worker', held: true }))
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ roomId: 'r1', memberId: 'worker', held: true }])
  assert.deepEqual(result.body.room.heldMembers, ['worker'])
})

test('cancelling a queued message goes through the live runtime', async () => {
  const calls = []
  const ctx = setup(roomRecord({ live: true, chatRoom: { id: 'chat-1' } }), {
    cancelQueued: async (roomId, queueId) => {
      calls.push({ roomId, queueId })
      return { cancelled: true }
    },
  })
  const result = await ctx.service.roomRequest('r1', 'cancel-queue', post({ queueId: 'q1' }))
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ roomId: 'r1', queueId: 'q1' }])
})

test('steering a queued message returns the engine outcome', async () => {
  const calls = []
  const ctx = setup(roomRecord({ live: true, chatRoom: { id: 'chat-1' } }), {
    isAttached: () => true,
    steerQueued: async (roomId, queueId) => {
      calls.push({ roomId, queueId })
      return { outcome: 'steered', messageIds: ['m1'], queueIds: [queueId] }
    },
  })
  const result = await ctx.service.roomRequest('r1', 'steer', post({ queueId: 'q1' }))
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ roomId: 'r1', queueId: 'q1' }])
  assert.equal(result.body.outcome, 'steered')
})

test('an active room cannot be deleted', async () => {
  const ctx = setup(roomRecord())
  const result = await ctx.service.roomRequest('r1', 'delete', post({}))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.equal(ctx.deleted(), null)
})

test('deleting a finished room removes it and emits room.deleted', async () => {
  const ctx = setup(roomRecord({ state: 'complete' }))
  const result = await ctx.service.roomRequest('r1', 'delete', post({}))
  assert.equal(result.ok, true)
  assert.equal(result.body.id, 'r1')
  assert.equal(ctx.deleted(), 'r1')
  assert.equal(ctx.removedPaths.length, 1)
  assert.match(ctx.removedPaths[0], /\.crew\/rooms\/r1$/)
  assert.equal(ctx.emitted.some(([event]) => event === 'room.deleted'), true)
})
