import assert from 'node:assert/strict'
import test from 'node:test'
import { toolScopeFor } from './tool-scope.js'

test('every member hides the base agents surface', () => {
  for (const roleKind of ['planner', 'executor', 'verifier', 'participant']) {
    assert.ok(toolScopeFor({ roleKind }).deny.includes('mcp:agents:*'), roleKind)
  }
})

test('no member can message other local Claude sessions or open subagents', () => {
  for (const roleKind of ['planner', 'executor', 'verifier', 'participant']) {
    const deny = toolScopeFor({ roleKind }).deny
    for (const tool of ['native:SendMessage', 'native:ListAgents', 'native:Agent', 'native:TaskStop']) {
      assert.ok(deny.includes(tool), `${roleKind} ${tool}`)
    }
  }
})

test('only the executor hides the room gate tools', () => {
  const native = ['native:SendMessage', 'native:ListAgents', 'native:Agent', 'native:TaskStop']
  assert.deepEqual(toolScopeFor({ roleKind: 'executor' }).deny, ['mcp:agents:*', ...native, 'mcp:lodge_gate:*'])
  assert.deepEqual(toolScopeFor({ roleKind: 'participant' }).deny, ['mcp:agents:*', ...native, 'mcp:lodge_gate:*'])
  assert.deepEqual(toolScopeFor({ roleKind: 'planner' }).deny, ['mcp:agents:*', ...native])
  assert.deepEqual(toolScopeFor({ roleKind: 'verifier' }).deny, ['mcp:agents:*', ...native])
})
