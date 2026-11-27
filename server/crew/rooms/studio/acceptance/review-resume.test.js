import assert from 'node:assert/strict'
import test from 'node:test'
import { resumePausedForReviewPass } from './review.js'

const storeFor = room => {
  const store = {
    room,
    events: [],
    readRoom: () => store.room,
    updateRoom: (_id, mutate) => {
      const change = mutate(store.room)
      if (change === null) return null
      store.events.push(...(change.events ?? []))
      return store.room
    },
  }
  return store
}

test('a passing review resumes a paused room before signoff', () => {
  const store = storeFor({ id: 'room-1', state: 'paused', idle: true, noProgress: 6 })
  assert.equal(resumePausedForReviewPass(store, 'room-1'), true)
  assert.equal(store.room.state, 'active')
  assert.equal(store.room.idle, false)
  assert.equal(store.room.noProgress, 0)
  assert.equal(store.events[0]?.payload?.reason, 'review-passed')
})

test('a running room is left alone', () => {
  const store = storeFor({ id: 'room-1', state: 'active', noProgress: 2 })
  assert.equal(resumePausedForReviewPass(store, 'room-1'), false)
  assert.equal(store.room.noProgress, 2)
  assert.equal(store.events.length, 0)
})
