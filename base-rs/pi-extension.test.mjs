// 基座注入的 pi 扩展：MCP 注册与工具审批。用假的 pi 对象直接跑，不调模型。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const modulePath = new URL('./src/drivers/pi-base-extension.mjs', import.meta.url).href

// 扩展在加载时读环境变量，所以每次用不同的查询串强制重新求值。
let loads = 0
const load = async (env = {}) => {
  const saved = { LODGE_APPROVAL: process.env.LODGE_APPROVAL, LODGE_READ_TOOLS: process.env.LODGE_READ_TOOLS, LODGE_MCP_CONFIG: process.env.LODGE_MCP_CONFIG, LODGE_GRANTED_TOOLS: process.env.LODGE_GRANTED_TOOLS, LODGE_AUTO_SERVERS: process.env.LODGE_AUTO_SERVERS, LODGE_SKILLS_DIR: process.env.LODGE_SKILLS_DIR }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  loads += 1
  const mod = await import(`${modulePath}?load=${loads}`)
  const registrations = []
  const handlers = {}
  const tools = {}
  const pi = {
    registerMcpServer: (name, config) => registrations.push({ name, config }),
    registerTool: definition => { tools[definition.name] = definition },
    on: (name, handler) => { handlers[name] = handler },
  }
  mod.default(pi)
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  return { handlers, registrations, tools }
}

const call = (handler, toolName, input = {}, answer = true) => {
  const asks = []
  const ctx = {
    ui: {
      confirm: async (title, message) => {
        asks.push({ title, message })
        return answer
      },
    },
  }
  return Promise.resolve(handler({ toolName, input }, ctx)).then(result => ({ result, asks }))
}

test('read-only tools pass without asking', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'ask' })
  for (const name of ['read', 'grep', 'find', 'ls']) {
    const { result, asks } = await call(handlers.tool_call, name, { path: 'x' })
    assert.equal(result, undefined)
    assert.equal(asks.length, 0)
  }
})

test('changing or external tools ask, and a no blocks the call', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'ask' })
  const allowed = await call(handlers.tool_call, 'write', { path: '/somewhere/else/hello.txt' }, true)
  assert.equal(allowed.asks.length, 1, 'asks before writing outside the workspace')
  assert.equal(allowed.result, undefined)
  // 本机删除由沙箱和证据兜底；真正会打出去的动作才值得停一次。
  const denied = await call(handlers.tool_call, 'bash', { command: 'curl https://example.com' }, false)
  assert.equal(denied.result?.block, true)
  assert.match(denied.result?.reason ?? '', /人拒绝了这次调用/)
  const external = await call(handlers.tool_call, 'mcp__chrome-devtools__click', {}, true)
  assert.equal(external.asks.length, 1, 'external tools ask too')
})

test('a local shell command runs without a human; external or install commands ask', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'ask' })
  for (const command of ['ls -la && git status 2>/dev/null | head -50', 'node tools/check.mjs', 'npm test', 'git clone /tmp/src /tmp/copy && git checkout -q HEAD']) {
    const { result, asks } = await call(handlers.tool_call, 'bash', { command })
    assert.equal(asks.length, 0, command)
    assert.equal(result, undefined, command)
  }
  for (const command of ['curl https://example.com', 'npm install left-pad', 'sudo rm -rf /']) {
    const { asks } = await call(handlers.tool_call, 'bash', { command }, true)
    assert.equal(asks.length, 1, command)
  }
})

test('room contract tools and auto mode never ask', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'ask' })
  const gate = await call(handlers.tool_call, 'mcp__lodge_gate__submit_plan', {})
  assert.equal(gate.asks.length, 0)
  const auto = await load({ LODGE_APPROVAL: 'auto' })
  const bash = await call(auto.handlers.tool_call, 'bash', { command: 'make test' })
  assert.equal(bash.asks.length, 0)
  assert.equal(bash.result, undefined)
})

test('mcp servers from the config are registered for this session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-extension-'))
  const config = join(dir, 'mcp.json')
  writeFileSync(config, JSON.stringify({ mcpServers: { gate: { command: 'node', args: ['x.js'] } } }))
  try {
    const { registrations } = await load({ LODGE_MCP_CONFIG: config })
    assert.deepEqual(registrations.map(item => item.name), ['gate'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('the tool grant is enforced even in auto mode, and contract tools stay open', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'auto', LODGE_GRANTED_TOOLS: 'read,mcp__gate__*' })
  const blocked = await call(handlers.tool_call, 'bash', { command: 'rm -rf x' })
  assert.equal(blocked.result?.block, true)
  assert.match(blocked.result?.reason ?? '', /没有这项工具/)
  const gate = await call(handlers.tool_call, 'mcp__lodge_gate__submit_plan', {})
  assert.equal(gate.result, undefined, 'contract tools belong to the room, not the grant')
  const granted = await call(handlers.tool_call, 'mcp__gate__submit', {})
  assert.equal(granted.result, undefined)
  const read = await call(handlers.tool_call, 'read', { path: 'x' })
  assert.equal(read.result, undefined)
})


test('a workspace-consented MCP server does not ask per call', async () => {
  const { handlers } = await load({
    LODGE_APPROVAL: 'ask',
    LODGE_GRANTED_TOOLS: 'mcp__desktop__*',
    LODGE_AUTO_SERVERS: 'desktop',
  })
  const click = await call(handlers.tool_call, 'mcp__desktop__click', { x: 1, y: 2 })
  assert.equal(click.asks.length, 0, 'the workspace choice is the consent')
  assert.equal(click.result, undefined)
  const other = await call(handlers.tool_call, 'mcp__other__click', {})
  assert.equal(other.result?.block, true, 'other servers still follow the grant')
})


test('a denied tool is visible but blocked with a reason', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'auto', LODGE_GRANTED_TOOLS: 'read,bash', LODGE_DENIED_TOOLS: 'bash' })
  const blocked = await call(handlers.tool_call, 'bash', { command: 'rm -rf x' })
  assert.equal(blocked.result?.block, true)
  assert.match(blocked.result?.reason ?? '', /禁止使用/)
})


test('the room can deny a contract tool for a role', async () => {
  const { handlers } = await load({
    LODGE_APPROVAL: 'auto',
    LODGE_GRANTED_TOOLS: 'mcp__lodge_gate__*',
    LODGE_DENIED_TOOLS: 'mcp__lodge_gate__submit_verdict',
  })
  const blocked = await call(handlers.tool_call, 'mcp__lodge_gate__submit_verdict', {})
  assert.equal(blocked.result?.block, true, 'a verifier must not submit a plan or a verdict it was denied')
  const plan = await call(handlers.tool_call, 'mcp__lodge_gate__submit_plan', {})
  assert.equal(plan.result, undefined)
})

test('writing inside the workspace copy needs no approval; outside does', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'ask' })
  const inside = await call(handlers.tool_call, 'write', { path: 'notes/inside.txt' })
  assert.equal(inside.asks.length, 0)
  const outside = await call(handlers.tool_call, 'write', { path: '../../../etc/passwd' }, true)
  assert.equal(outside.asks.length, 1)
})

test('skills are read on demand, and only the ones this member has', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-skills-'))
  writeFileSync(join(dir, 'lodge-build.md'), '# Build\n先跑最小切片。')
  try {
    const { tools } = await load({ LODGE_SKILLS_DIR: dir })
    const tool = tools.use_skill
    assert.notEqual(tool, undefined, 'use_skill is registered when skills exist')
    const read = async name => (await tool.execute('t1', { name }, undefined, undefined, {}))
      .content[0].text
    assert.match(await read('lodge-build'), /先跑最小切片/)
    // 没分到的技能、目录外的名字都读不到。
    assert.match(await read('other-skill'), /没有这个技能/)
    assert.match(await read('../secret'), /没有这个技能/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without a skills directory no skill tool is registered', async () => {
  const { tools } = await load({ LODGE_SKILLS_DIR: undefined })
  assert.equal(tools.use_skill, undefined)
})

test('the gate’s spill reader never waits for a person', async () => {
  const { handlers } = await load({ LODGE_APPROVAL: 'ask' })
  for (const name of ['lodge_mcp_read', 'mcp__probe__lodge_mcp_read']) {
    const { result, asks } = await call(handlers.tool_call, name, { path: '/tmp/spill.txt' })
    assert.equal(result, undefined, name)
    assert.equal(asks.length, 0, name)
  }
})
