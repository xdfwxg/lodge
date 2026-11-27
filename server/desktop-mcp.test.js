import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureDesktopMcp, desktopMcpUrl } from './desktop-mcp.js'

const withEnv = async (value, fn) => {
  const saved = process.env.LODGE_DESKTOP_MCP_URL
  if (value === undefined) delete process.env.LODGE_DESKTOP_MCP_URL
  else process.env.LODGE_DESKTOP_MCP_URL = value
  try {
    return await fn()
  } finally {
    if (saved === undefined) delete process.env.LODGE_DESKTOP_MCP_URL
    else process.env.LODGE_DESKTOP_MCP_URL = saved
  }
}

test('the provider must be a loopback URL with an explicit port', async () => {
  await withEnv(undefined, () => assert.equal(desktopMcpUrl(), ''))
  await withEnv('http://127.0.0.1:8897/mcp', () => assert.equal(desktopMcpUrl(), 'http://127.0.0.1:8897/mcp'))
  await withEnv('http://localhost:8897/sse', () => assert.equal(desktopMcpUrl(), 'http://localhost:8897/sse'))
  await withEnv('http://[::1]:8897/mcp', () => assert.equal(desktopMcpUrl(), 'http://[::1]:8897/mcp'))
  await withEnv('http://example.com:8897/mcp', () => assert.equal(desktopMcpUrl(), '', 'remote providers are not reachable through the sandbox'))
  await withEnv('http://127.0.0.1/mcp', () => assert.equal(desktopMcpUrl(), '', 'a port is required'))
  await withEnv('http://127.0.0.1:9999/mcp', () => assert.equal(desktopMcpUrl(), '', 'the port must be in the sandbox range'))
})

test('the provider is registered once and its URL is updated in place', async () => {
  await withEnv('http://127.0.0.1:8897/mcp', async () => {
    const servers = []
    const engine = {
      mcp: {
        list: async () => servers,
        create: async server => { servers.push(server); return servers },
        update: async (name, body) => { const item = servers.find(item => item.name === name); Object.assign(item, body); return servers },
        patch: async () => servers,
      },
    }
    assert.equal(await ensureDesktopMcp(engine), true)
    assert.equal(servers.length, 1)
    assert.equal(servers[0].url, 'http://127.0.0.1:8897/mcp')
  })
})
