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

const setup = (room, liveOverrides = {}, portOverrides = {}, storeOverrides = {}) => {
  let current = room
  const emitted = []
  const removedPaths = []
  const cancelledTimers = []
  const messages = []
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
    appendMessage: (id, message) => {
      messages.push(message)
      return {}
    },
    appendEvent: () => {},
    cancelWork: id => cancelledTimers.push(id),
    readAssignments: () => [],
    ...storeOverrides,
  }
  const ports = { ...createCrewPorts(), ...portOverrides }
  ports.files = { ...ports.files, remove: path => removedPaths.push(path) }
  const service = createCrewService({
    store,
    engine: { health: async () => ({}), instances: async () => [] },
    live: { isAttached: () => false, detach: () => {}, ...liveOverrides },
    emit: (event, payload) => emitted.push([event, payload]),
    roles: [],
    ports,
  })
  return {
    service,
    emitted,
    removedPaths,
    cancelledTimers,
    messages,
    deleted: () => deleted,
    room: () => current,
  }
}

const post = body => ({ method: 'POST', readBody: async () => body })

test('renaming a room updates its name and emits the room', async () => {
  const ctx = setup(roomRecord())
  const result = await ctx.service.roomRequest('r1', 'rename', post({ name: '新名字' }))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.name, '新名字')
  assert.equal(ctx.emitted.some(([event]) => event === 'room'), true)
})

test('saving a profile emits it for every open window', async () => {
  const ctx = setup(roomRecord())
  try {
    const result = ctx.service.saveProfile({ name: '千寻', avatar: null })
    assert.equal(result.ok, true)
    const emitted = ctx.emitted.find(([event]) => event === 'profile')
    assert.equal(emitted?.[1]?.name, '千寻')
  } finally {
    ctx.service.saveProfile({ name: '', avatar: null })
  }
})

test('archiving an active room stops it without a running engine', async () => {
  const ctx = setup(roomRecord({ live: true }))
  const result = await ctx.service.roomRequest('r1', 'archive', post({}))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.state, 'stopped')
  assert.equal(result.body.room.live, false)
  assert.equal(typeof result.body.room.archivedAt, 'number')
})

test('restoring a room clears the archive marker', async () => {
  const ctx = setup(roomRecord({ archivedAt: 1, state: 'idle' }))
  const result = await ctx.service.roomRequest('r1', 'archive', post({ archived: false }))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.archivedAt, null)
})

test('restoring an archived room returns it to idle, never reopens the round', async () => {
  const attached = []
  const ctx = setup(roomRecord({
    state: 'stopped',
    live: false,
    archivedAt: 1,
    archivedLive: true,
  }), {
    attach: async room => {
      attached.push(room.id)
      return {}
    },
  })
  const result = await ctx.service.roomRequest('r1', 'archive', post({ archived: false }))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.state, 'idle')
  assert.equal(result.body.room.live, false)
  assert.equal(result.body.room.archivedAt, null)
  assert.deepEqual(attached, [])
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

test('interrupting a reply keeps the room active and cancels open work', async () => {
  const calls = []
  const cancelled = []
  const ctx = setup(roomRecord({ live: true, roomType: 'studio' }), {
    isAttached: () => true,
    cancel: async ({ roomId }) => {
      calls.push(roomId)
      return { cancelled: true }
    },
  }, {}, {
    readAssignments: () => [
      { id: 'a1', status: 'sent' },
      { id: 'a2', status: 'passed' },
    ],
    updateAssignment: (id, mutate) => {
      const assignment = { id, status: 'sent' }
      if (mutate(assignment) === false) return null
      cancelled.push({ id, status: assignment.status })
      return assignment
    },
  })
  const result = await ctx.service.roomRequest('r1', 'interrupt', post({}))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.state, 'active')
  assert.equal(result.body.room.pauseReason, undefined)
  assert.equal(result.body.cancelled, true)
  assert.equal(result.body.assignments, 1)
  assert.deepEqual(calls, ['r1'])
  assert.deepEqual(cancelled, [{ id: 'a1', status: 'cancelled' }])
})

test('a room that is not running cannot interrupt a reply', async () => {
  const ctx = setup(roomRecord({ state: 'idle', live: false }))
  const result = await ctx.service.roomRequest('r1', 'interrupt', post({}))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.equal(result.error, '房间没有在跑')
})

test('resuming a paused room reattaches it when the runtime dropped', async () => {
  const attached = []
  const ctx = setup(roomRecord({ state: 'paused', live: true }), {
    isAttached: () => false,
    attach: async room => { attached.push(room.id) },
  })
  const result = await ctx.service.roomRequest('r1', 'resume', post({}))
  assert.equal(result.ok, true)
  assert.equal(result.body.room.state, 'active')
  assert.deepEqual(attached, ['r1'])
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

test('a studio with an open round cannot be deleted', async () => {
  const ctx = setup(roomRecord({ activeRoundId: 'round-1', workRound: { status: 'active' } }))
  const result = await ctx.service.roomRequest('r1', 'delete', post({}))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.equal(ctx.deleted(), null)
})

test('deleting a finished room removes it and emits room.deleted', async () => {
  const ctx = setup(roomRecord({ state: 'idle' }))
  const result = await ctx.service.roomRequest('r1', 'delete', post({}))
  assert.equal(result.ok, true)
  assert.equal(result.body.id, 'r1')
  assert.equal(ctx.deleted(), 'r1')
  assert.equal(ctx.removedPaths.length, 1)
  assert.match(ctx.removedPaths[0], /\.crew\/rooms\/r1$/)
  assert.equal(ctx.emitted.some(([event]) => event === 'room.deleted'), true)
})
