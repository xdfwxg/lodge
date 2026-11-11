import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceProgress, NO_PROGRESS_LIMIT } from './progress.js'

const room = () => ({ state: 'active', round: 0, noProgress: 0, idle: false })

test('a turn increments the round and a productive turn resets the counter', () => {
  const r = room()
  advanceProgress(r, { progressed: false })
  advanceProgress(r, { progressed: false })
  assert.equal(r.round, 2)
  assert.equal(r.noProgress, 2)
  advanceProgress(r, { progressed: true })
  assert.equal(r.round, 3)
  assert.equal(r.noProgress, 0)
})

test('six turns without output pause the room and wait for the human', () => {
  const r = room()
  let paused = false
  for (let i = 0; i < NO_PROGRESS_LIMIT; i += 1) {
    paused = advanceProgress(r, { progressed: false }).paused
  }
  assert.equal(paused, true)
  assert.equal(r.state, 'paused')
  assert.equal(r.idle, true)
})

test('a productive turn before the limit keeps the room active', () => {
  const r = room()
  for (let i = 0; i < NO_PROGRESS_LIMIT - 1; i += 1) advanceProgress(r, { progressed: false })
  advanceProgress(r, { progressed: true })
  assert.equal(r.state, 'active')
  assert.equal(r.noProgress, 0)
})

test('an already paused room is not paused twice', () => {
  const r = room()
  r.state = 'paused'
  r.noProgress = NO_PROGRESS_LIMIT - 1
  const result = advanceProgress(r, { progressed: false })
  assert.equal(result.paused, false)
  assert.equal(r.idle, false)
})
