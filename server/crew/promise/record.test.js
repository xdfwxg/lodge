import assert from 'node:assert/strict'
import test from 'node:test'
import { recordPromiseDelivery } from './record.js'

const setup = (promise = {}) => {
  const room = {
    id: 'room-1',
    workRound: { id: 'round-1' },
    promise: {
      text: '每周整理',
      schedule: { every: 'week', weekday: 5, at: '18:00' },
      delivery: { channel: 'room', to: '', mode: 'always' },
      status: 'active',
      version: 1,
      ...promise,
    },
  }
  const store = {
    updateRoom: (id, mutate) => {
      const change = mutate(room)
      return change === null ? null : room
    },
  }
  return { room, store }
}

const messages = text => [{ kind: 'conclusion', text }]

test('the first delivery is marked first, then the same content is no change', () => {
  const ctx = setup()
  const first = recordPromiseDelivery({ store: ctx.store, room: ctx.room, messages: messages('A') })
  assert.equal(first.promise.lastChange, 'first')
  ctx.room.workRound = { id: 'round-2' }
  const same = recordPromiseDelivery({ store: ctx.store, room: ctx.room, messages: messages('A') })
  assert.equal(same.promise.lastChange, 'no')
  ctx.room.workRound = { id: 'round-3' }
  const changed = recordPromiseDelivery({ store: ctx.store, room: ctx.room, messages: messages('B') })
  assert.equal(changed.promise.lastChange, 'yes')
})

test('the same round is only recorded once', () => {
  const ctx = setup()
  recordPromiseDelivery({ store: ctx.store, room: ctx.room, messages: messages('A') })
  const version = ctx.room.promise.version
  const again = recordPromiseDelivery({ store: ctx.store, room: ctx.room, messages: messages('B') })
  assert.equal(again.promise.version, version)
})
