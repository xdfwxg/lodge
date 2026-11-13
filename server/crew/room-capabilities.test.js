import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilitiesFor, ROOM_CAPABILITIES } from './room-capabilities.js'

test('chat and studio capabilities stay separated', () => {
  assert.equal(capabilitiesFor('chat').stages, false)
  assert.equal(capabilitiesFor('chat').closure, false)
  assert.equal(capabilitiesFor('chat').piExecution, false)
  assert.equal(capabilitiesFor('studio').closure, true)
  assert.equal(capabilitiesFor('studio').verdict, true)
  assert.equal(capabilitiesFor('mystery'), null)
  assert.equal(Object.isFrozen(ROOM_CAPABILITIES.chat), true)
})
