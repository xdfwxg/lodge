import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasBrowserGrant,
  isBrowserGrant,
  isBrowserTool,
  isReadOnlyResearchTool,
} from './room-access.js'

test('browser research is a read-only grant, not a room mode', () => {
  const grant = { server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }
  assert.equal(isBrowserGrant(grant), true)
  assert.equal(isBrowserGrant({ ...grant, scopes: ['read', 'write'] }), false)
  assert.equal(isBrowserGrant({ ...grant, approval: 'auto' }), false)
  assert.equal(hasBrowserGrant({ mcp: [grant] }), true)
  assert.equal(hasBrowserGrant({ body: { spec: { mcp: [grant] } } }), true)
  assert.equal(hasBrowserGrant({}), false)
})

test('only browser MCP tools are recognized as browser work', () => {
  assert.equal(isBrowserTool('mcp__chrome-devtools__navigate_page'), true)
  assert.equal(isBrowserTool('Bash'), false)
  assert.equal(isBrowserTool('mcp__lodge_gate__submit_verdict'), false)
})

test('read-only research covers browser, search and fetch, but not commands', () => {
  assert.equal(isReadOnlyResearchTool('mcp__chrome-devtools__take_snapshot'), true)
  assert.equal(isReadOnlyResearchTool('WebSearch'), true)
  assert.equal(isReadOnlyResearchTool('WebFetch'), true)
  assert.equal(isReadOnlyResearchTool('Bash'), false)
  assert.equal(isReadOnlyResearchTool('Write'), false)
})
