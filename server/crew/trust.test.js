import assert from 'node:assert/strict'
import test from 'node:test'
import { trustLevelOf } from './trust.js'

test('trust defaults to verify and old rooms are not auto-elevated', () => {
  assert.equal(trustLevelOf({}), 'verify')
  assert.equal(trustLevelOf({ trust: 'observe' }), 'observe')
  assert.equal(trustLevelOf({ trust: 'auto' }), 'auto')
  assert.equal(trustLevelOf({ trust: 'admin' }), 'verify')
})
