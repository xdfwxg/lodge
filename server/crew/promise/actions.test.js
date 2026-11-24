import assert from 'node:assert/strict'
import test from 'node:test'
import { createPromiseActions } from './actions.js'

const makeRoom = (over = {}) => ({
  id: 'room-1',
  roomType: 'studio',
  live: true,
  demo: false,
  state: 'idle',
  goal: '每周挑 5 个值得看的 GitHub 项目',
  activeRoundId: null,
  workRound: { status: 'completed' },
  members: [],
  ...over,
})

const setup = (room = makeRoom()) => {
  const messages = []
  const work = []
  const cancelled = []
  const store = {
    updateRoom: (id, mutate) => {
      const change = mutate(room)
      return change === null ? null : room
    },
    appendMessage: (roomId, message) => { messages.push({ roomId, ...message }) },
    enqueueWork: item => { work.push(item); return item },
    cancelWork: id => { cancelled.push(id) },
  }
  const actions = createPromiseActions({ store, emit: () => {} })
  const call = (name, body = {}) => actions[name]({
    room,
    roomId: room.id,
    readBody: async () => body,
  })
  return { room, messages, work, cancelled, call }
}

test('a studio can make a weekly promise and the first tick is queued', async () => {
  const ctx = setup()
  const result = await ctx.call('promise', { text: '每周挑 5 个项目', schedule: { every: 'week', weekday: 5, at: '18:00' } })
  assert.equal(result.ok, true)
  assert.equal(ctx.room.promise.text, '每周挑 5 个项目')
  assert.equal(ctx.work.length, 1)
  assert.equal(ctx.work[0].kind, 'promise.tick')
})

test('a non-studio room cannot hold a promise', async () => {
  const ctx = setup(makeRoom({ roomType: 'chat' }))
  const result = await ctx.call('promise', { text: '每周整理' })
  assert.equal(result.ok, false)
  assert.match(result.error, /工作间/)
})

test('a promise can be paused and resumed without losing its text', async () => {
  const ctx = setup(makeRoom({
    promise: {
      text: '每周挑 5 个项目',
      schedule: { every: 'week', weekday: 5, at: '18:00' },
      status: 'active',
      nextAt: Date.now() + 86_400_000,
      version: 1,
      runs: 0,
    },
  }))
  const paused = await ctx.call('promise-update', { status: 'paused' })
  assert.equal(paused.ok, true)
  assert.equal(ctx.room.promise.status, 'paused')
  assert.equal(ctx.room.promise.text, '每周挑 5 个项目')
  assert.equal(ctx.cancelled.length, 1)
  const resumed = await ctx.call('promise-update', { status: 'active' })
  assert.equal(resumed.ok, true)
  assert.equal(ctx.room.promise.status, 'active')
  assert.equal(ctx.work.length, 1)
})

test('restarting a stopped promise clears its miss count', async () => {
  const ctx = setup(makeRoom({
    promise: {
      text: '每周挑 5 个项目',
      schedule: { every: 'week', weekday: 5, at: '18:00' },
      status: 'stopped',
      nextAt: Date.now() + 86_400_000,
      version: 1,
      runs: 3,
      misses: 3,
      stoppedReason: 'misses',
    },
  }))
  const resumed = await ctx.call('promise-update', { status: 'active' })
  assert.equal(resumed.ok, true)
  assert.equal(ctx.room.promise.status, 'active')
  assert.equal(ctx.room.promise.misses, 0)
  assert.equal(ctx.room.promise.stoppedReason, null)
})

test('run now queues one manual tick and refuses while a round is open', async () => {
  const ctx = setup(makeRoom({
    promise: {
      text: '每周挑 5 个项目',
      schedule: { every: 'week', weekday: 5, at: '18:00' },
      status: 'active',
      nextAt: Date.now() + 86_400_000,
      version: 1,
      runs: 0,
    },
  }))
  const result = await ctx.call('promise-run')
  assert.equal(result.ok, true)
  assert.equal(ctx.work[0].payload.manual, true)
  ctx.room.activeRoundId = 'round-open'
  const busy = await ctx.call('promise-run')
  assert.equal(busy.ok, false)
  assert.match(busy.error, /还没结束/)
})
