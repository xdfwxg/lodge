import test from 'node:test'
import assert from 'node:assert/strict'
import { GATE_TOOLS, handleMessage } from './mcp-server.js'

test('the gate server speaks the minimal MCP handshake', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  })
  assert.equal(response.result.protocolVersion, '2025-06-18')
  assert.equal(response.result.serverInfo.name, 'lodge-gate')
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } })
})

test('the gate server lists only the two judgment tools', () => {
  const response = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(response.result.tools.map(tool => tool.name), ['submit_verdict', 'submit_decision'])
  assert.equal(GATE_TOOLS[0].inputSchema.required.includes('reason'), true)
})

test('a verdict call echoes a structured result', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: { decision: 'REJECT', reason: '缺少日志', findings: [{ title: '没有运行记录' }] },
    },
  })
  assert.equal(response.result.isError, undefined)
  assert.equal(response.result.structuredContent.decision, 'REJECT')
  assert.equal(response.result.structuredContent.reason, '缺少日志')
})

test('a verdict can cite the platform visual check', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: { decision: 'PASS', reason: '画面层次正常', visual: { seen: false, colors: 50, contrast: 255 } },
    },
  })
  assert.deepEqual(response.result.structuredContent.visual, { seen: false, colors: 50, contrast: 255 })
})

test('a malformed visual field is refused', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'PASS', reason: 'x', visual: { colors: 3 } } },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /seen/)
})

test('an invalid verdict is refused without breaking the connection', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'MAYBE', reason: 'x' } },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /PASS 或 REJECT/)
})

test('a planner decision accepts the Chinese anchor', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'submit_decision', arguments: { decision: '交给人', reason: '权限只能你定' } },
  })
  assert.equal(response.result.structuredContent.decision, 'human')
})

test('notifications are silent and unknown methods get an error', () => {
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  const response = handleMessage({ jsonrpc: '2.0', id: 6, method: 'nope' })
  assert.equal(response.error.code, -32601)
})
