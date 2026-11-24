import assert from 'node:assert/strict'
import test from 'node:test'
import { browserMcpConfig, ensureBrowserMcp } from './browser-mcp.js'
import { BROWSER_MCP_BLOCKED_PATTERNS, BROWSER_MCP_SERVER_NAME } from '../shared/browser-mcp.js'

test('the browser server runs isolated and refuses input and local files', () => {
  const config = browserMcpConfig()
  assert.equal(config.name, BROWSER_MCP_SERVER_NAME)
  for (const flag of ['--headless', '--isolated', '--no-category-input', '--no-javascript-evaluation', '--no-file-navigations']) {
    assert.ok(config.args.includes(flag), `${flag} is missing`)
  }
  assert.ok(config.args.includes('--blocked-url-pattern=http://127.0.0.1/*'))
  assert.ok(config.args.includes('--blocked-url-pattern=http://localhost:*/*'))
  assert.ok(config.args.includes('--blocked-url-pattern=file://*'))
  assert.ok(!config.args.some(arg => arg.startsWith('--allowed-url-pattern=')))
  // 服务器会拒绝部分 IPv4 通配（127.*）和 IPv6 字面量；每个模式都必须真的能构造。
  for (const pattern of BROWSER_MCP_BLOCKED_PATTERNS) {
    assert.doesNotThrow(() => new URLPattern(pattern), pattern)
    assert.doesNotMatch(pattern, /\/\/\d+\.\*/)
  }
  // 基座拒绝超过 64 项的数组；参数再多就建不起房。
  assert.ok(config.args.length <= 64, `browser server has ${config.args.length} args`)
})

test('ensuring the browser server registers it once', async () => {
  const calls = []
  const engine = {
    mcp: {
      list: async () => [],
      create: async payload => {
        calls.push(payload)
        return { servers: [{ ...payload, enabled: true }] }
      },
      patch: async () => {},
    },
  }
  assert.equal(await ensureBrowserMcp(engine), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, BROWSER_MCP_SERVER_NAME)
  assert.equal(await ensureBrowserMcp(engine), true)
  assert.equal(calls.length, 1)
})

test('an existing browser server with the same config is only re-enabled', async () => {
  const calls = []
  const config = browserMcpConfig()
  const engine = {
    mcp: {
      list: async () => ({ servers: [{ ...config, enabled: false }] }),
      create: async () => { throw new Error('should not create') },
      patch: async (name, body) => calls.push(['patch', name, body]),
      update: async () => { throw new Error('should not update') },
    },
  }
  assert.equal(await ensureBrowserMcp(engine), true)
  assert.deepEqual(calls, [['patch', BROWSER_MCP_SERVER_NAME, { enabled: true }]])
})

test('a stale browser server config is replaced and left enabled', async () => {
  const calls = []
  const engine = {
    mcp: {
      list: async () => [{ name: BROWSER_MCP_SERVER_NAME, command: 'old', args: ['--old'], enabled: false }],
      create: async () => { throw new Error('should not create') },
      update: async (name, body) => calls.push(['update', name, body]),
    },
  }
  assert.equal(await ensureBrowserMcp(engine), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'update')
  assert.equal(calls[0][1], BROWSER_MCP_SERVER_NAME)
  assert.equal(calls[0][2].enabled, true)
  assert.equal('name' in calls[0][2], false)
})

test('a server created disabled is enabled right after creation', async () => {
  const calls = []
  const engine = {
    mcp: {
      list: async () => ({ servers: [] }),
      create: async payload => ({ servers: [{ ...payload, enabled: false }] }),
      patch: async (name, body) => calls.push([name, body]),
    },
  }
  assert.equal(await ensureBrowserMcp(engine), true)
  assert.deepEqual(calls, [[BROWSER_MCP_SERVER_NAME, { enabled: true }]])
})

test('an engine without an MCP API is left alone', async () => {
  assert.equal(await ensureBrowserMcp({}), false)
  assert.equal(await ensureBrowserMcp(null), false)
})

test('a failed registration is retried instead of cached as false', async () => {
  let attempts = 0
  const engine = {
    mcp: {
      list: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('base down')
        return []
      },
      create: async payload => ({ servers: [{ ...payload, enabled: true }] }),
    },
  }
  assert.equal(await ensureBrowserMcp(engine), false)
  assert.equal(await ensureBrowserMcp(engine), true)
  assert.equal(attempts, 2)
})
