import assert from 'node:assert/strict'
import test from 'node:test'
import { toolScopeFor } from './tool-scope.js'

test('every member hides the base agents surface', () => {
  for (const roleKind of ['planner', 'executor', 'verifier', 'participant']) {
    assert.ok(toolScopeFor({ roleKind }).deny.includes('mcp:agents:*'), roleKind)
  }
})

test('tool scope never narrows native tools: claudeAgent cannot run with that selection', () => {
  for (const roleKind of ['planner', 'executor', 'verifier', 'participant']) {
    for (const selector of toolScopeFor({ roleKind }).deny) {
      assert.equal(selector.startsWith('native:'), false, `${roleKind} ${selector}`)
    }
  }
})

test('only the executor hides the room gate tools', () => {
  assert.deepEqual(toolScopeFor({ roleKind: 'executor' }).deny, ['mcp:agents:*', 'mcp:lodge_gate:*'])
  assert.deepEqual(toolScopeFor({ roleKind: 'participant' }).deny, ['mcp:agents:*', 'mcp:lodge_gate:*'])
  assert.deepEqual(toolScopeFor({ roleKind: 'planner' }).deny, ['mcp:agents:*'])
  assert.deepEqual(toolScopeFor({ roleKind: 'verifier' }).deny, ['mcp:agents:*'])
})
