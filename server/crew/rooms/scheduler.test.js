import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomScheduler } from './scheduler.js'

const harness = ({ fail = false } = {}) => {
  const timers = [{ id: 't1', roomId: 'r1', kind: 'approval', payload: { approvalId: 'a1' }, dueAt: 1 }]
  const inbox = []
  const calls = { expired: [], completed: [], failed: [] }
  const store = {
    dueTimers: () => timers.filter(item => item.status !== 'done'),
    completeTimer: id => {
      const item = timers.find(value => value.id === id)
      if (item === undefined || item.status === 'done') return { changes: 0 }
      item.status = 'done'
      return { changes: 1 }
    },
    enqueueInbox: event => { inbox.push({ id: `e${inbox.length + 1}`, ...event }) },
    readRooms: () => [{ id: 'r1' }],
    claimInbox: roomId => {
      const event = inbox.find(item => item.roomId === roomId && item.status === undefined)
      if (event === undefined) return null
      event.status = 'running'
      return event
    },
    completeInbox: id => calls.completed.push(id),
    failInbox: id => calls.failed.push(id),
  }
  const live = {
    expireApprovals: async (roomId, reason) => {
      if (fail) throw new Error('nope')
      calls.expired.push({ roomId, reason })
    },
  }
  return { scheduler: createRoomScheduler({ store, live, now: () => 2 }), calls, inbox }
}

test('a due timer becomes one inbox event and one expiry', async () => {
  const { scheduler, calls } = harness()
  await scheduler.tick()
  assert.deepEqual(calls.expired, [{ roomId: 'r1', reason: '确认超时' }])
  assert.deepEqual(calls.completed, ['e1'])
  await scheduler.tick()
  assert.equal(calls.expired.length, 1)
})

test('a failed handler is kept as failed instead of silently dropping it', async () => {
  const { scheduler, calls } = harness({ fail: true })
  await scheduler.tick()
  assert.deepEqual(calls.failed, ['e1'])
  assert.deepEqual(calls.completed, [])
})

test('a due routine timer starts one run of its room', async () => {
  const timers = [{
    id: 'routine:r1',
    roomId: 'r1',
    kind: 'routine',
    payload: { sourceRoomId: 'r1' },
    dueAt: 1,
  }]
  const inbox = []
  const calls = []
  const store = {
    dueTimers: () => timers.filter(item => item.status !== 'done'),
    completeTimer: id => {
      const item = timers.find(value => value.id === id)
      if (item === undefined || item.status === 'done') return { changes: 0 }
      item.status = 'done'
      return { changes: 1 }
    },
    enqueueInbox: event => inbox.push({ id: `e${inbox.length + 1}`, ...event }),
    readRooms: () => [{ id: 'r1' }],
    claimInbox: () => {
      const event = inbox.find(item => item.status === undefined)
      if (event === undefined) return null
      event.status = 'running'
      return event
    },
    completeInbox: () => {},
    failInbox: () => {},
  }
  const scheduler = createRoomScheduler({
    store,
    live: {},
    onRoutine: async id => calls.push(id),
    now: () => 2,
    intervalMs: 60_000,
  })
  await scheduler.tick()
  assert.deepEqual(calls, ['r1'])
})
