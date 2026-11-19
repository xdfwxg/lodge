import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoutineRunner } from './routine-runner.js'

const NOW = new Date(2026, 10, 19, 10, 0).getTime()
const TOMORROW = new Date(2026, 10, 20, 8, 0).getTime()

const source = (over = {}) => ({
  id: 'goal',
  name: '每日摘要',
  goal: '整理今天的邮件',
  roomType: 'studio',
  state: 'complete',
  verify: 'manual',
  sourceRepo: '/tmp/repo',
  routine: {
    cadence: 'daily',
    hour: 8,
    minute: 0,
    enabled: true,
    failures: 0,
    nextRunAt: NOW - 60_000,
    ...over,
  },
})

const setup = ({ initial = [source()], createRoom = async () => ({ ok: true, body: { room: { id: 'run-1' } } }) } = {}) => {
  const rooms = new Map(initial.map(room => [room.id, structuredClone(room)]))
  const timers = []
  const cancelled = []
  const messages = []
  const calls = []
  const store = {
    readRoom: id => rooms.get(id) ?? null,
    updateRoom: (id, mutate) => {
      const current = rooms.get(id)
      if (current === undefined) return null
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      rooms.set(id, next)
      return next
    },
    setTimer: timer => timers.push(timer),
    cancelTimer: id => cancelled.push(id),
    appendMessage: (roomId, message) => messages.push({ roomId, ...message }),
  }
  const service = {
    createRoom: async body => {
      calls.push(body)
      return createRoom(body)
    },
  }
  const runner = createRoutineRunner({ store, service, emit: () => {}, now: () => NOW })
  return { runner, rooms, timers, cancelled, messages, calls }
}

test('a due routine starts one hidden run and schedules the next morning', async () => {
  const { runner, rooms, timers, calls } = setup({
    initial: [
      source(),
      { id: 'run-1', state: 'active', name: '11月19日 10:00' },
    ],
  })
  await runner('goal')
  const goal = rooms.get('goal')
  assert.equal(goal.routine.lastRoomId, 'run-1')
  assert.deepEqual(goal.routine.runIds, ['run-1'])
  assert.equal(goal.routine.nextRunAt, TOMORROW)
  assert.equal(rooms.get('run-1').routineGoalId, 'goal')
  assert.equal(rooms.get('run-1').routineRun, true)
  assert.equal(calls[0].goal, '整理今天的邮件')
  assert.equal(calls[0].repoPath, '/tmp/repo')
  assert.equal(timers.at(-1).dueAt, TOMORROW)
  assert.equal(timers.at(-1).id, 'routine:goal')
})

test('a start that fails is retried next time, not immediately', async () => {
  const { runner, rooms, timers, messages } = setup({
    createRoom: async () => ({ ok: false, error: '模型没准备好' }),
  })
  await runner('goal')
  const goal = rooms.get('goal')
  assert.equal(goal.routine.failures, 1)
  assert.equal(goal.routine.lastError, '模型没准备好')
  assert.equal(goal.routine.nextRunAt, TOMORROW)
  assert.equal(timers.at(-1).dueAt, TOMORROW)
  assert.match(messages.at(-1).text, /这次没开始：模型没准备好/)
})

test('three failed starts stop the rhythm and offer no timer', async () => {
  const { runner, rooms, timers, cancelled, messages } = setup({
    initial: [source({ failures: 2 })],
    createRoom: async () => ({ ok: false, error: '模型没准备好' }),
  })
  await runner('goal')
  const goal = rooms.get('goal')
  assert.equal(goal.routine.failures, 3)
  assert.equal(goal.routine.paused, true)
  assert.equal(goal.routine.enabled, false)
  assert.equal(goal.routine.nextRunAt, null)
  assert.equal(timers.length, 0)
  assert.deepEqual(cancelled, ['routine:goal'])
  assert.match(messages.at(-1).text, /连续 3 次没做成/)
})

test('an unfinished run keeps the next one out and is not a failure', async () => {
  const { runner, rooms, timers, calls } = setup({
    initial: [
      source({ lastRoomId: 'run-old' }),
      { id: 'run-old', state: 'paused' },
    ],
  })
  await runner('goal')
  const goal = rooms.get('goal')
  assert.equal(calls.length, 0)
  assert.equal(goal.routine.skippedAt, NOW)
  assert.equal(goal.routine.failures, 0)
  assert.equal(goal.routine.nextRunAt, TOMORROW)
  assert.equal(timers.at(-1).dueAt, TOMORROW)
})

test('a late timer waits for today when today’s slot is still ahead', async () => {
  const early = new Date(2026, 10, 19, 7, 0).getTime()
  const rooms = new Map([
    ['goal', source({ nextRunAt: early - 86_400_000 })],
  ])
  const timers = []
  const calls = []
  const store = {
    readRoom: id => rooms.get(id) ?? null,
    updateRoom: (id, mutate) => {
      const next = structuredClone(rooms.get(id))
      mutate(next)
      rooms.set(id, next)
      return next
    },
    setTimer: timer => timers.push(timer),
    cancelTimer: () => {},
    appendMessage: () => {},
  }
  const runner = createRoutineRunner({
    store,
    service: { createRoom: async body => { calls.push(body); return { ok: true } } },
    now: () => early,
  })
  await runner('goal')
  assert.equal(calls.length, 0)
  assert.equal(rooms.get('goal').routine.nextRunAt, new Date(2026, 10, 19, 8, 0).getTime())
  assert.equal(timers[0].dueAt, new Date(2026, 10, 19, 8, 0).getTime())
})

test('only the latest twenty runs stay visible', async () => {
  const runIds = Array.from({ length: 20 }, (_, index) => `run-${index}`)
  const initial = [
    source({ runIds }),
    ...runIds.map(id => ({ id, state: 'complete' })),
    { id: 'run-20', state: 'active' },
  ]
  const { runner, rooms } = setup({
    initial,
    createRoom: async () => ({ ok: true, body: { room: { id: 'run-20' } } }),
  })
  await runner('goal')
  const goal = rooms.get('goal')
  assert.equal(goal.routine.runIds.length, 20)
  assert.equal(goal.routine.runIds[0], 'run-1')
  assert.equal(goal.routine.runIds.at(-1), 'run-20')
  assert.equal(Number.isFinite(rooms.get('run-0').archivedAt), true)
})
