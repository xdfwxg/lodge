import assert from 'node:assert/strict'
import test from 'node:test'
import { decidePermission } from './permission.js'

const planner = { permissions: { read: true, exec: false, write: false } }
const verifier = { permissions: { read: true, exec: true, write: false } }
const executor = { permissions: { read: true, exec: true, write: true } }

test('read-only seats cannot execute or write', () => {
  assert.equal(decidePermission(planner, 'read'), true)
  assert.equal(decidePermission(planner, 'exec'), false)
  assert.equal(decidePermission(planner, 'write'), false)
})

test('verifier reads and executes but cannot use write tools', () => {
  assert.equal(decidePermission(verifier, 'read'), true)
  assert.equal(decidePermission(verifier, 'exec'), true)
  assert.equal(decidePermission(verifier, 'write'), false)
})

test('worker keeps its declared write surface', () => {
  assert.equal(decidePermission(executor, 'write'), true)
})

test('unknown actions and missing seats fail closed', () => {
  assert.equal(decidePermission(planner, 'network'), false)
  assert.equal(decidePermission(undefined, 'read'), false)
  assert.equal(decidePermission({}, 'write'), false)
})
