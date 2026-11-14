import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilitiesFor } from './room-types/index.js'

test('chat and studio capabilities stay separated', () => {
  assert.equal(capabilitiesFor('chat').stages, false)
  assert.equal(capabilitiesFor('chat').closure, false)
  assert.equal(capabilitiesFor('chat').piExecution, false)
  assert.equal(capabilitiesFor('studio').closure, true)
  assert.equal(capabilitiesFor('studio').verdict, true)
  assert.equal(capabilitiesFor('mystery'), null)
  assert.equal(Object.isFrozen(capabilitiesFor('chat')), true)
  assert.equal(Object.isFrozen(capabilitiesFor('studio')), true)
})
