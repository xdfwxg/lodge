import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminActions } from './admin.js'

const setup = over => {
  let room = {
    id: 'room-1',
    name: '一间房',
    state: 'active',
    live: false,
    archivedAt: null,
    activeRoundId: null,
    workRound: { status: 'stopped' },
    ...over,
  }
  const stopped = []
  const deleted = []
  const actions = createAdminActions({
    store: {},
    live: {
      isAttached: () => false,
      detach: () => {},
      cancel: async () => ({}),
      retireRoomBots: async () => {},
    },
    emit: () => {},
    roomFiles: { roomDir: () => '' },
    files: { remove: () => {} },
    memberAdd: {},
    memberRemove: {},
    stopRound: async ({ room: target }) => {
      stopped.push(target.id)
      room = { ...room, state: 'stopped', activeRoundId: null, workRound: { status: 'stopped' } }
      return { ok: true }
    },
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const next = structuredClone(room)
      const change = mutate(next)
      if (change === null || change === undefined || change === false) return null
      room = next
      return room
    },
    deleteRoom: id => {
      deleted.push(id)
      return true
    },
  })
  return { actions, room: () => room, stopped, deleted }
}

test('archiving stops a round that the stale menu snapshot could not see', async () => {
  const ctx = setup({ workRound: { status: 'active' } })
  const stale = { id: 'room-1', state: 'active', live: false, activeRoundId: null, workRound: { status: 'stopped' } }
  const result = await ctx.actions.archive({ room: stale, readBody: async () => ({}) })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.stopped, ['room-1'])
  assert.equal(typeof ctx.room().archivedAt, 'number')
  assert.equal(ctx.room().activeRoundId, null)
  assert.equal(ctx.room().state, 'stopped')
})

test('archiving clears a leftover round pointer without stopping again', async () => {
  const ctx = setup({ activeRoundId: 'round-9', workRound: { status: 'completed' } })
  await ctx.actions.archive({ room: ctx.room(), readBody: async () => ({}) })
  assert.deepEqual(ctx.stopped, [])
  assert.equal(ctx.room().activeRoundId, null)
  assert.equal(typeof ctx.room().archivedAt, 'number')
})

test('an archived room can be deleted even with a leftover round pointer', async () => {
  const ctx = setup({ archivedAt: 1, state: 'stopped', activeRoundId: 'round-9', workRound: { status: 'active' } })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.deleted, ['room-1'])
})

test('a running room still cannot be deleted before archiving', async () => {
  const ctx = setup({ state: 'active', activeRoundId: 'round-1' })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, false)
  assert.deepEqual(ctx.deleted, [])
})
