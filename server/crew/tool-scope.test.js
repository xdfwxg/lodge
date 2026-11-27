import assert from 'node:assert/strict'
import test from 'node:test'
import { executionProfileFor, nativeToolsFor, toolScopeFor } from './tool-scope.js'

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

test('native tools follow the member permissions', () => {
  assert.deepEqual(nativeToolsFor({ permissions: { read: true } }), ['read', 'grep', 'find', 'ls'])
  assert.deepEqual(
    nativeToolsFor({ permissions: { read: true, write: true, exec: true } }),
    ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'],
  )
  assert.deepEqual(nativeToolsFor({ permissions: { read: false, write: false, exec: false } }), [])
  assert.deepEqual(nativeToolsFor({}), [], 'no declaration means no tools')
})

test('members without native tools get the strict profile; tool users get the standard one', () => {
  assert.equal(executionProfileFor({ permissions: {} }), 'strict')
  assert.equal(executionProfileFor({ permissions: { read: false, write: false, exec: false } }), 'strict')
  assert.equal(executionProfileFor({ permissions: { read: true } }), 'standard')
  assert.equal(executionProfileFor({ permissions: { read: true, write: true, exec: true } }), 'standard')
})

test('codex cannot run in a throwaway HOME, so its members stay on the standard profile', () => {
  assert.equal(executionProfileFor({ permissions: {} }, 'codex'), 'standard')
  assert.equal(executionProfileFor({ permissions: {} }, 'pi'), 'strict')
  assert.equal(executionProfileFor({ permissions: {} }, 'claude'), 'strict')
})
