import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createPlannerMcp } from '../planner-mcp.js'

const temp = () => mkdtempSync(join(tmpdir(), 'lodge-planner-mcp-'))

const fakeClient = ({ servers = [], calls = [] } = {}) => {
  let listed = [...servers]
  return {
    calls,
    mcp: {
      list: async () => ({ servers: listed }),
      create: async payload => {
        calls.push({ kind: 'create', payload })
        listed = [...listed, { ...payload, enabled: false }]
      },
      update: async (name, payload) => {
        calls.push({ kind: 'update', name, payload })
      },
      patch: async (name, payload) => {
        calls.push({ kind: 'patch', name, payload })
        listed = listed.map(server => server.name === name ? { ...server, ...payload } : server)
      },
      remove: async name => {
        calls.push({ kind: 'remove', name })
        listed = listed.filter(server => server.name !== name)
      },
    },
    invoke: async (roomId, tool) => {
      calls.push({ kind: 'invoke', roomId, tool })
      if (tool.name === 'reject_plan') return { ok: false, reason: 'conflict', error: '已经进入执行' }
      return { ok: true, body: { roomId, tool: tool.name, args: tool.args } }
    },
  }
}

const call = async ({ mcp, roomId, payload, token }) => {
  const req = Readable.from([JSON.stringify(payload)])
  req.method = 'POST'
  req.headers = { authorization: `Bearer ${token ?? mcp.tokenFor(roomId)}` }
  const captured = { status: 0, headers: null, body: '' }
  const res = {
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers ?? null
    },
    end(data) {
      captured.body = data === undefined ? '' : String(data)
    },
  }
  const handled = await mcp.handle(req, res, `/mcp/planner/${roomId}`)
  return { handled, ...captured, json: captured.body === '' ? null : JSON.parse(captured.body) }
}

test('planner MCP answers initialize and lists the three room tools', async () => {
  const dir = temp()
  const mcp = createPlannerMcp({ client: fakeClient(), dataDir: dir, port: 8787 })
  const initialized = await call({
    mcp,
    roomId: 'room-abc123',
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  })
  assert.equal(initialized.status, 200)
  assert.equal(initialized.json.result.protocolVersion, '2025-06-18')
  assert.equal(initialized.json.result.serverInfo.name, 'lodge-planner')

  const listed = await call({ mcp, roomId: 'room-abc123', payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' } })
  assert.deepEqual(
    listed.json.result.tools.map(tool => tool.name),
    ['create_subroom', 'reject_plan', 'check_gate'],
  )
})

test('planner MCP requires the room token and calls back into Lodge', async () => {
  const dir = temp()
  const client = fakeClient()
  const mcp = createPlannerMcp({ client, dataDir: dir, port: 8787 })

  const denied = await call({
    mcp,
    roomId: 'room-abc123',
    token: 'wrong',
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  })
  assert.equal(denied.status, 401)

  const ok = await call({
    mcp,
    roomId: 'room-abc123',
    payload: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_subroom', arguments: { goal: '补测试' } },
    },
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.result.isError, undefined)
  const invoked = client.calls.find(item => item.kind === 'invoke')
  assert.deepEqual(invoked.tool, { name: 'create_subroom', args: { goal: '补测试' } })

  const failed = await call({
    mcp,
    roomId: 'room-abc123',
    payload: {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'reject_plan', arguments: { reason: '不可行' } },
    },
  })
  assert.equal(failed.json.result.isError, true)
  assert.match(failed.json.result.content[0].text, /已经进入执行/)
})

test('planner MCP registration is idempotent and reconciles orphan servers', async () => {
  const dir = temp()
  const client = fakeClient()
  client.mcp.list = async () => ({
    servers: [
      { name: 'lodge-planner-room-gone01', enabled: true },
      { name: 'lodge-planner-room-live01', enabled: false },
      { name: 'other', enabled: true },
    ],
  })
  const mcp = createPlannerMcp({ client, dataDir: dir, port: 8787 })

  const created = await mcp.ensure('room-new01')
  assert.equal(created.server, 'lodge-planner-room-new01')
  assert.equal(client.calls.some(item => item.kind === 'create'), true)
  assert.equal(client.calls.some(item => item.kind === 'patch' && item.payload.enabled === true), true)

  const result = await mcp.reconcile([
    { id: 'room-live01', kind: 'room', roomType: 'studio', state: 'active' },
  ])
  assert.equal(result.removed, 1)
  assert.equal(client.calls.some(item => item.kind === 'remove' && item.name === 'lodge-planner-room-gone01'), true)
  assert.equal(client.calls.some(item => item.kind === 'remove' && item.name === 'other'), false)
})
