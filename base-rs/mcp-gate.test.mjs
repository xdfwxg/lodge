// 基座 MCP 网关：结果按预算裁、全文落回合目录、工具面封顶。
// 不连模型，只跟一个会吐大结果的 stdio 服务器说话。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fixture = join(dir, 'fixtures', 'mcp-big.mjs')
const spill = mkdtempSync(join(tmpdir(), 'lodge-gate-spill-'))
const upstream = JSON.stringify({ command: process.execPath, args: [fixture] })

const child = spawn(bin, ['--mcp-gate'], {
  env: {
    ...process.env,
    LODGE_MCP_UPSTREAM: upstream,
    LODGE_MCP_NAME: 'probe',
    LODGE_MCP_SPILL_DIR: spill,
    LODGE_MCP_BUDGET: '1000',
    LODGE_MCP_TOOL_CAP: '2',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})

const pending = new Map()
let buffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line !== '') {
      const message = JSON.parse(line)
      const waiter = pending.get(String(message.id))
      if (waiter !== undefined) {
        pending.delete(String(message.id))
        waiter(message)
      }
    }
    index = buffer.indexOf('\n')
  }
})

let nextId = 1
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++
  const timer = setTimeout(() => {
    pending.delete(String(id))
    reject(new Error(`timeout: ${method}`))
  }, 10_000)
  pending.set(String(id), message => {
    clearTimeout(timer)
    resolve(message)
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
})
const call = name => request('tools/call', { name, arguments: {} })

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  })
  assert.equal(init.result.serverInfo.name, 'big')
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

  const list = await request('tools/list', {})
  assert.equal(list.result.tools.length, 3, '外部工具封顶 2 个，另加一个读回工具')
  assert.ok(list.result.tools[0].description.length <= 600, '描述要裁到 600 字以内')
  assert.equal(list.result.tools[0].inputSchema.type, 'object', '参数表不能动')
  assert.equal(list.result.tools.at(-1).name, 'lodge_mcp_read', '读回工具要出现在工具面里')

  const small = await call('small')
  assert.equal(small.result.content[0].text, 'ok', '短结果原样放行')

  const big = await call('big')
  const text = big.result.content[0].text
  assert.ok(text.length < 20_000, '长结果要裁')
  assert.ok(text.startsWith('x'.repeat(1_000)), '保留开头')
  assert.match(text, /完整结果在/)
  const files = readdirSync(spill).filter(name => name.endsWith('.txt'))
  assert.equal(files.length, 1, '全文只落一份')
  const full = readFileSync(join(spill, files[0]), 'utf8')
  assert.equal(full.length, 20_000, '落盘的是全文')
  assert.ok(text.includes(files[0]), '提示里要写清去哪个文件找')

  // 读回工具不依赖成员的原生读文件能力，也只在落盘目录里找。
  const page = await request('tools/call', {
    name: 'lodge_mcp_read',
    arguments: { path: join(spill, files[0]), offset: 100, limit: 12 },
  })
  assert.equal(page.result.isError, false)
  assert.equal(page.result.content[0].text.slice(0, 12), 'x'.repeat(12))
  const outside = await request('tools/call', {
    name: 'lodge_mcp_read',
    arguments: { path: join(spill, '..', 'mcp-gate.test.mjs') },
  })
  assert.equal(outside.result.isError, true, '落盘目录之外一律不读')

  const second = await call('note')
  assert.ok(second.result.content[0].text.length < 20_000, '第二个长结果也要裁')
  assert.equal(readdirSync(spill).filter(name => name.endsWith('.txt')).length, 2, '每个长结果各落一份')

  child.stdin.end()
  const code = await new Promise(resolve => child.on('exit', resolve))
  assert.equal(code, 0, '上游退出后网关也干净退出')
} finally {
  child.kill('SIGKILL')
  rmSync(spill, { recursive: true, force: true })
}
