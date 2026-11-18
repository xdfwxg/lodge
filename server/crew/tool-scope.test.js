import assert from 'node:assert/strict'
import test from 'node:test'
import { toolScopeFor } from './tool-scope.js'

test('every member hides the base agents surface', () => {
  for (const roleKind of ['planner', 'executor', 'verifier', 'participant']) {
    assert.ok(toolScopeFor({ roleKind }).deny.includes('mcp:agents:*'), roleKind)
  }
})

test('only the executor hides the room gate tools', () => {
  assert.ok(toolScopeFor({ roleKind: 'executor' }).deny.includes('mcp:lodge_gate:*'))
  assert.ok(toolScopeFor({ roleKind: 'participant' }).deny.includes('mcp:lodge_gate:*'))
  assert.equal(toolScopeFor({ roleKind: 'planner' }).deny.includes('mcp:lodge_gate:*'), false)
  assert.equal(toolScopeFor({ roleKind: 'verifier' }).deny.includes('mcp:lodge_gate:*'), false)
})
