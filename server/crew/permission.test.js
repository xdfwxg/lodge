import assert from 'node:assert/strict'
import test from 'node:test'
import { decidePermission } from './permission.js'

const planner = { role: 'lead', roleKind: 'planner', permissions: { read: true, exec: false, write: false } }
const verifier = { role: 'verifier', roleKind: 'verifier', permissions: { read: true, exec: true, write: false } }
const executor = { role: 'worker', roleKind: 'executor', permissions: { read: true, exec: true, write: true } }

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

test('a read-only discussion stage blocks write and exec even for a worker', () => {
  assert.equal(decidePermission(executor, 'read', { readOnly: true }), true)
  assert.equal(decidePermission(executor, 'write', { readOnly: true }), false)
  assert.equal(decidePermission(executor, 'exec', { readOnly: true }), false)
})

test('the built-in gate tool is allowed only for the role that owns it', () => {
  assert.equal(decidePermission(planner, 'gate', { tool: 'mcp__lodge_gate__submit_plan' }), true)
  assert.equal(decidePermission(verifier, 'gate', { tool: 'mcp__lodge_gate__submit_verdict' }), true)
  assert.equal(decidePermission(executor, 'gate', { tool: 'mcp__lodge_gate__submit_verdict' }), false)
  assert.equal(decidePermission(planner, 'gate', { tool: 'mcp__lodge_gate__submit_verdict' }), false)
  assert.equal(decidePermission(verifier, 'gate', { tool: 'mcp__lodge_gate__submit_plan' }), false)
  assert.equal(decidePermission(planner, 'gate'), false)
  assert.equal(decidePermission(planner, 'gate', { tool: 'mcp__other__lodge_gate__submit_plan' }), false)
  assert.equal(decidePermission(planner, 'gate', { readOnly: true, tool: 'mcp__lodge_gate__submit_plan' }), true)
  assert.equal(decidePermission(verifier, 'gate', { direct: true, tool: 'mcp__lodge_gate__submit_verdict' }), true)
})

test('unknown actions and missing seats fail closed', () => {
  assert.equal(decidePermission(planner, 'network'), false)
  assert.equal(decidePermission(undefined, 'read'), false)
  assert.equal(decidePermission({}, 'write'), false)
})

test('a verifier in a direct workspace cannot exec', async () => {
  const { decidePermission } = await import('./permission.js')
  const verifier = { role: 'verifier', permissions: { read: true, exec: true, write: false } }
  assert.equal(decidePermission(verifier, 'read', { direct: true }), true)
  assert.equal(decidePermission(verifier, 'exec', { direct: true }), false)
  assert.equal(decidePermission(verifier, 'exec'), true)
})
