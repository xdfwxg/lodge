// 真正的浏览器 MCP 进程：用交付时的参数启动，走 MCP 握手并列出工具。
// 参数一旦被服务器拒绝，这里会红，而不是等到成员第一次要浏览器时才发现。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { browserMcpConfig } from './browser-mcp.js'

const INPUT_TOOLS = /^(click|fill|type|press|hover|drag|upload|evaluate_script)/

test('the browser server starts with the shipped flags and exposes read-only tools', { timeout: 30_000 }, async () => {
  const config = browserMcpConfig()
  const child = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })

  const tools = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`browser MCP did not answer\n${stderr.slice(0, 1000)}`)), 25_000)
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`)
    child.stdout.on('data', chunk => {
      buffer += chunk.toString()
      let cut
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        if (!line.startsWith('{')) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.id === 2) {
          clearTimeout(timer)
          resolve(message.result?.tools ?? [])
        }
      }
    })
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`browser MCP exited with ${code}\n${stderr.slice(0, 1000)}`))
    })
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lodge-test', version: '1' },
      },
    })
    setTimeout(() => {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    }, 800)
  })
  try {
    const names = tools.map(tool => tool.name)
    assert.ok(names.includes('navigate_page'), names.join(','))
    assert.ok(names.includes('take_screenshot'), names.join(','))
    assert.ok(names.includes('take_snapshot'), names.join(','))
    // --no-category-input / --no-javascript-evaluation 必须真的生效。
    assert.deepEqual(names.filter(name => INPUT_TOOLS.test(name)), [])
    assert.ok(!names.includes('evaluate_script'))
  } finally {
    child.kill('SIGTERM')
  }
})
