import assert from 'node:assert/strict'
import test from 'node:test'
import { isTempDeleteApproval } from './approvals.mjs'

const approval = over => ({
  state: 'pending',
  kind: 'delete',
  target: '/tmp/cleanbase',
  command: 'rm -rf /tmp/cleanbase && mkdir -p /tmp/cleanbase',
  ...over,
})

test('a delete confined to /tmp is the eval room’s own cleanup', () => {
  assert.equal(isTempDeleteApproval(approval()), true)
})

test('a delete that touches anything outside /tmp stays for a person', () => {
  assert.equal(isTempDeleteApproval(approval({ command: 'rm -rf /tmp/cleanbase /Users/me/notes' })), false)
  assert.equal(isTempDeleteApproval(approval({ target: '/Users/me/notes' })), false)
  assert.equal(isTempDeleteApproval(approval({ target: '/tmp' })), false)
  assert.equal(isTempDeleteApproval(approval({ command: 'rm -rf /tmp/../etc' })), false)
})

test('other actions are never auto-approved', () => {
  assert.equal(isTempDeleteApproval(approval({ kind: 'write' })), false)
  assert.equal(isTempDeleteApproval(approval({ state: 'allowed' })), false)
  assert.equal(isTempDeleteApproval(approval({ command: '' })), false)
})
