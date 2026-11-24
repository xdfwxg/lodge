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

test('the executor and chat members hide the whole room gate', () => {
  assert.deepEqual(toolScopeFor({ roleKind: 'executor' }).deny, ['mcp:agents:*', 'mcp:lodge_gate:*', 'mcp:ogb:ask_user'])
  assert.deepEqual(toolScopeFor({ roleKind: 'participant' }).deny, ['mcp:agents:*', 'mcp:lodge_gate:*'])
})

test('the planner never sees the verdict tool', () => {
  const deny = toolScopeFor({ roleKind: 'planner' }).deny
  assert.ok(deny.includes('mcp:lodge_gate:submit_verdict'))
  assert.equal(deny.includes('mcp:lodge_gate:submit_decision'), false)
})

test('the verifier only sees the verdict tool', () => {
  const deny = toolScopeFor({ roleKind: 'verifier' }).deny
  for (const tool of ['submit_decision', 'submit_plan', 'adjust_member_model', 'ask_decision', 'ask_question', 'rewind_stage', 'stop_round', 'resume_round']) {
    assert.ok(deny.includes(`mcp:lodge_gate:${tool}`), tool)
  }
  assert.equal(deny.includes('mcp:lodge_gate:submit_verdict'), false)
})
