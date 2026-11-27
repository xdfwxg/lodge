import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_MCP_SERVER_NAME } from './browser-mcp.js'
import {
  hasBrowserGrant,
  isBrowserGrant,
  isBrowserTool,
  isReadOnlyResearchTool,
} from './room-access.js'
import { canSkipApproval, grantBrowserToAll } from '../server/crew/room-access.js'

test('browser research is a read-only grant, not a room mode', () => {
  const grant = { server: 'chrome-devtools', approval: 'ask' }
  assert.equal(isBrowserGrant(grant), true)
  // 别的服务器不是浏览器授权；只读与否由工具名那张表决定，不看授权字段。
  assert.equal(isBrowserGrant({ server: 'github', approval: 'ask' }), false)
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

test('read-only research covers safe browser reads, search and fetch, but not commands', () => {
  assert.equal(isReadOnlyResearchTool('mcp__chrome-devtools__take_snapshot'), true)
  assert.equal(isReadOnlyResearchTool('WebSearch'), true)
  assert.equal(isReadOnlyResearchTool('WebFetch'), true)
  assert.equal(isReadOnlyResearchTool('Bash'), false)
  assert.equal(isReadOnlyResearchTool('Write'), false)
})

const tool = name => `mcp__${BROWSER_MCP_SERVER_NAME}__${name}`
const member = { mcp: [{ server: BROWSER_MCP_SERVER_NAME, approval: 'ask' }] }

test('read-only research covers web search and safe browser reads', () => {
  assert.equal(isReadOnlyResearchTool('WebSearch'), true)
  assert.equal(isReadOnlyResearchTool('WebFetch'), true)
  assert.equal(isReadOnlyResearchTool(tool('take_snapshot')), true)
  assert.equal(isReadOnlyResearchTool(tool('list_network_requests')), true)
  assert.equal(isReadOnlyResearchTool(tool('get_console_message')), true)
})

test('browser actions that change external state need approval', () => {
  for (const name of ['click', 'fill', 'type_text', 'upload_file', 'evaluate_script', 'handle_dialog', 'get_cookies', 'read_local_file']) {
    assert.equal(isReadOnlyResearchTool(tool(name)), false, name)
  }
  assert.equal(canSkipApproval({ member, tool: tool('click') }), false)
  assert.equal(canSkipApproval({ member, tool: tool('take_snapshot') }), true)
})

test('every member gets the same read-only public web grant', () => {
  const roster = grantBrowserToAll([{ name: '聊天' }, { name: '规划' }, { name: '执行' }, { name: '验收' }])
  assert.equal(roster.every(item => item.mcp.some(grant => grant.server === BROWSER_MCP_SERVER_NAME)), true)
})
