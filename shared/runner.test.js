import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTOR_ROLE, actorOf, canDecide, canExecute } from './runner.js'

test('a device can decide but never executes', () => {
  const phone = actorOf({ role: ACTOR_ROLE.DEVICE, id: 'phone-1' })
  assert.equal(canDecide(phone), true)
  assert.equal(canExecute(phone), false)
})

test('a runner can execute and decide, and unknown roles fail closed', () => {
  const mac = actorOf({ role: ACTOR_ROLE.RUNNER, id: 'mac-1' })
  assert.equal(canExecute(mac), true)
  assert.equal(canDecide(mac), true)
  assert.equal(actorOf({ role: 'admin' }).role, ACTOR_ROLE.DEVICE)
  assert.equal(canExecute({ role: 'admin' }), false)
})
