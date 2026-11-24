import assert from 'node:assert/strict'
import test from 'node:test'
import { nextPromiseRunAt } from '../../../shared/promise.js'
import { createPromiseRunner } from './runtime.js'

const at = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

const setup = ({ busy = false, state = 'idle', promiseStatus = 'active' } = {}) => {
  const now = at(2026, 11, 23, 9) // Monday
  const promise = {
    text: '每周挑 5 个值得看的 GitHub 项目',
    schedule: { every: 'week', weekday: 5, at: '18:00' },
    status: promiseStatus,
    nextAt: nextPromiseRunAt({ every: 'week', weekday: 5, at: '18:00' }, now),
    runs: 0,
    version: 1,
    lastRunAt: null,
    lastRoundId: null,
    lastRunStatus: null,
  }
  const room = {
    id: 'room-1',
    roomType: 'studio',
    live: true,
    state,
    activeRoundId: busy ? 'round-open' : null,
    workRound: { status: busy ? 'active' : 'completed' },
    goal: promise.text,
    promise,
  }
  const messages = []
  const work = []
  const store = {
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const next = mutate(room)
      if (next === null) return null
      room.version += 1
      return room
    },
    appendMessage: (roomId, message) => { messages.push({ roomId, ...message }) },
    enqueueWork: item => { work.push(item); return item },
    cancelWork: () => {},
  }
  const rounds = []
  const startRound = async input => {
    rounds.push(input)
    return { ok: true, body: { round: { id: 'round-2' } } }
  }
  const runner = createPromiseRunner({ store, live: {}, emit: () => {}, startRound, roomFiles: {} })
  return { room, promise, store, messages, work, rounds, runner, now }
}

test('a due promise starts one round and arms the next one', async () => {
  const ctx = setup()
  const handled = await ctx.runner({ roomId: 'room-1', kind: 'promise.tick', payload: { at: ctx.promise.nextAt } })
  assert.equal(handled, true)
  assert.equal(ctx.rounds.length, 1)
  assert.equal(ctx.rounds[0].body.goal, ctx.promise.text)
  assert.equal(ctx.rounds[0].body.autoDeliver, true)
  assert.equal(ctx.room.promise.runs, 1)
  assert.equal(ctx.room.promise.lastRoundId, 'round-2')
  assert.ok(ctx.work.some(item => item.availableAt === ctx.room.promise.nextAt))
})

test('a busy room skips this occurrence and arms the next one', async () => {
  const ctx = setup({ busy: true })
  await ctx.runner({ roomId: 'room-1', kind: 'promise.tick', payload: { at: ctx.promise.nextAt } })
  assert.equal(ctx.rounds.length, 0)
  assert.equal(ctx.room.promise.lastRunStatus, 'skipped')
  assert.ok(ctx.work.some(item => item.availableAt === ctx.room.promise.nextAt))
  assert.ok(ctx.messages.some(message => message.text.includes('跳过了')))
})

test('a paused promise does nothing', async () => {
  const ctx = setup({ promiseStatus: 'paused' })
  const handled = await ctx.runner({ roomId: 'room-1', kind: 'promise.tick', payload: { at: ctx.promise.nextAt } })
  assert.equal(handled, true)
  assert.equal(ctx.rounds.length, 0)
  assert.equal(ctx.work.length, 0)
})

test('a tick missed while the app was closed runs once and says it was made up', async () => {
  const ctx = setup()
  ctx.promise.nextAt = Date.now() - 7 * 24 * 60 * 60 * 1000
  await ctx.runner({ roomId: 'room-1', kind: 'promise.tick', payload: { at: ctx.promise.nextAt } })
  assert.equal(ctx.rounds.length, 1)
  assert.equal(ctx.room.promise.runs, 1)
  assert.ok(ctx.room.promise.nextAt > Date.now())
  assert.ok(ctx.messages.some(message => message.text.includes('补上')))
})

test('a stale tick does not start a round', async () => {
  const ctx = setup()
  await ctx.runner({ roomId: 'room-1', kind: 'promise.tick', payload: { at: ctx.promise.nextAt - 1 } })
  assert.equal(ctx.rounds.length, 0)
})

test('a failed start is recorded and the next occurrence is armed', async () => {
  const ctx = setup()
  ctx.runner = createPromiseRunner({
    store: ctx.store,
    live: {},
    emit: () => {},
    startRound: async () => ({ ok: false, error: '这一轮还没结束' }),
    roomFiles: {},
  })
  await ctx.runner({ roomId: 'room-1', kind: 'promise.tick', payload: { at: ctx.promise.nextAt } })
  assert.equal(ctx.room.promise.lastRunStatus, 'failed')
  assert.ok(ctx.work.some(item => item.availableAt === ctx.room.promise.nextAt))
  assert.ok(ctx.messages.some(message => message.text.includes('没开起来')))
})
