import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomScheduler } from './scheduler.js'

const harness = ({ fail = false } = {}) => {
  const calls = { expired: [], completed: [], failed: [] }
  let claimed = false
  const event = { id: 'w1', roomId: 'r1', kind: 'approval', payload: { approvalId: 'a1' } }
  const store = {
    readRooms: () => [{ id: 'r1' }],
    claimWork: roomId => {
      if (claimed || roomId !== 'r1') return null
      claimed = true
      return event
    },
    completeWork: id => calls.completed.push(id),
    failWork: id => calls.failed.push(id),
  }
  const live = {
    handleWork: async item => {
      if (fail) throw new Error('nope')
      calls.expired.push({ roomId: item.roomId, kind: item.kind })
      return true
    },
  }
  return { scheduler: createRoomScheduler({ store, live, now: () => 2 }), calls }
}

test('a due work item is claimed once and handed to the room', async () => {
  const { scheduler, calls } = harness()
  await scheduler.tick()
  assert.deepEqual(calls.expired, [{ roomId: 'r1', kind: 'approval' }])
  assert.deepEqual(calls.completed, ['w1'])
  await scheduler.tick()
  assert.equal(calls.expired.length, 1)
})

test('an unhandled work kind is retried instead of being marked done', async () => {
  const calls = { completed: [], failed: [] }
  let claimed = false
  const event = { id: 'w2', roomId: 'r1', kind: 'unknown', payload: {} }
  const scheduler = createRoomScheduler({
    store: {
      readRooms: () => [{ id: 'r1' }],
      claimWork: () => {
        if (claimed) return null
        claimed = true
        return event
      },
      completeWork: id => calls.completed.push(id),
      failWork: id => calls.failed.push(id),
    },
    live: { handleWork: async () => false },
    now: () => 2,
  })
  await scheduler.tick()
  assert.deepEqual(calls.failed, ['w2'])
  assert.deepEqual(calls.completed, [])
})

test('a failed handler is retried instead of being dropped', async () => {
  const { scheduler, calls } = harness({ fail: true })
  await scheduler.tick()
  assert.deepEqual(calls.failed, ['w1'])
  assert.deepEqual(calls.completed, [])
})
