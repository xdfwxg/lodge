import assert from 'node:assert/strict'
import test from 'node:test'
import { stopAdviceReady } from './stop-advice.js'

test('a stop advice waits for in-flight work and an open review', () => {
  assert.equal(stopAdviceReady({}), true)
  assert.equal(stopAdviceReady({ assignments: [{ status: 'reported' }, { status: 'passed' }] }), true)
  assert.equal(stopAdviceReady({ assignments: [{ status: 'sent' }] }), false)
  assert.equal(stopAdviceReady({ assignments: [{ status: 'working' }] }), false)
  assert.equal(stopAdviceReady({ reviewBusy: true }), false)
})
