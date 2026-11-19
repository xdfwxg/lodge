import assert from 'node:assert/strict'
import test from 'node:test'
import { browserMcpConfig, ensureBrowserMcp } from './browser-mcp.js'
import { BROWSER_MCP_SERVER_NAME } from '../shared/browser-mcp.js'

test('the browser server runs isolated and refuses input and local files', () => {
  const config = browserMcpConfig()
  assert.equal(config.name, BROWSER_MCP_SERVER_NAME)
  for (const flag of ['--headless', '--isolated', '--no-category-input', '--no-javascript-evaluation', '--no-file-navigations']) {
    assert.ok(config.args.includes(flag), `${flag} is missing`)
  }
  assert.ok(config.args.includes('--blocked-url-pattern=http://127.*'))
  assert.ok(config.args.includes('--blocked-url-pattern=http://172.*'))
  assert.ok(!config.args.some(arg => arg.startsWith('--allowed-url-pattern=')))
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
