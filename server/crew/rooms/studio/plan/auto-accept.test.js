import assert from 'node:assert/strict'
import test from 'node:test'
import { autoAcceptStageOf, createStudioAutoAcceptor } from './auto-accept.js'

const room = (over = {}) => ({
  id: 'room-1',
  roomType: 'studio',
  state: 'active',
  demo: false,
  needsYou: { kind: 'signoff', stage: 1 },
  ...over,
})

test('only a working studio waiting for signoff is auto-accepted', () => {
  assert.equal(autoAcceptStageOf(room()), 1)
  assert.equal(autoAcceptStageOf(room({ roomType: 'chat' })), null)
  assert.equal(autoAcceptStageOf(room({ state: 'paused' })), null)
  assert.equal(autoAcceptStageOf(room({ demo: true })), null)
  assert.equal(autoAcceptStageOf(room({ needsYou: null })), null)
  assert.equal(autoAcceptStageOf(room({ needsYou: { kind: 'decision', stage: 1 } })), null)
  assert.equal(autoAcceptStageOf(room({ needsYou: { kind: 'signoff', stage: '1' } })), null)
})

test('the same room and stage is scheduled once', () => {
  const scheduled = []
  const acceptor = createStudioAutoAcceptor({
    accept: async () => {},
    schedule: (run, ms) => {
      scheduled.push({ run, ms })
      return scheduled.length
    },
  })
  assert.equal(acceptor.accept(room()), true)
  assert.equal(acceptor.accept(room()), false)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].ms, 400)
  acceptor.stop()
})

test('the timer confirms the stage and a failure goes to the error handler', async () => {
  const runs = []
  const accepted = []
  const errors = []
  const acceptor = createStudioAutoAcceptor({
    accept: async (target, stage) => {
      accepted.push([target.id, stage])
      throw new Error('确认失败')
    },
    onError: (target, stage, error) => errors.push([target.id, stage, error.message]),
    schedule: run => {
      runs.push(run)
      return runs.length
    },
  })
  acceptor.accept(room())
  runs[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(accepted, [['room-1', 1]])
  assert.deepEqual(errors, [['room-1', 1, '确认失败']])
})

test('stop cancels scheduled confirmations', () => {
  const cancelled = []
  const runs = []
  const acceptor = createStudioAutoAcceptor({
    accept: async () => {},
    schedule: run => {
      runs.push(run)
      return runs.length
    },
    cancel: id => cancelled.push(id),
  })
  acceptor.accept(room())
  acceptor.stop()
  assert.deepEqual(cancelled, [1])
  assert.equal(runs.length, 1)
})
