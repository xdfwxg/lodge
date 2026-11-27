// 真实 pi + 真实 MCP 服务器：外部工具必须先开审批卡，拒绝就真的不执行。
// 会调用模型，按需运行：`npm run base:rs:mcp:real`。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'
import { createEngine } from '../server/engine.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const probe = join(dir, 'fixtures', 'mcp-probe.mjs')
const port = 20800 + Math.floor(Math.random() * 90)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-mcp-'))
const work = mkdtempSync(join(tmpdir(), 'lodge-mcp-work-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 900) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return true
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
})

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  const client = createBaseClient({ baseUrl })
  const engine = createEngine({ client })
  await client.createMcpServer({ name: 'probe', command: process.execPath, args: [probe], enabled: true })

  const bot = (await client.createBot({
    name: '外部工具成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: {
      approvalMode: 'ask',
      mcpServers: ['probe'],
      nativeTools: ['read'],
      cwd: work,
      budget: { idleMs: 90_000, maxMs: 240_000 },
      lease: { read: [], write: [], exec: false, network: [] },
    },
  })).bot
  const group = (await client.createGroup({ name: '外部工具房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: work,
    bulletin: '外部工具审批',
    defaultResponder: { kind: 'member', botId: bot.id },
    followMentions: false,
  })

  const events = []
  let connected = false
  engine.subscribe({
    roomId: group.id,
    sessionRef: group.threadId,
    onEvent: event => events.push(event),
    onState: state => { if (state?.connected === true) connected = true },
  })
  await waitFor(() => connected, 'events connected')

  const cards = () => events.filter(event => event.type === 'message' && event.message?.card?.requestType === 'permission')
  const textSince = (index, needle) => events.slice(index).some(event => (
    event.type === 'message' && String(event.message?.text ?? '').includes(needle)
  ))
  // 工具真的执行过，才会有它自己的活动（start/end 都带工具名）。
  const toolRunsSince = index => events.slice(index).filter(event => (
    event.type === 'message' && event.message?.kind === 'activity' && String(event.message?.meta?.tool ?? '').includes('probe')
  ))

  // 第一回合：让它调用 MCP 工具。不回答之前，工具不能执行。
  await client.sendGroupMessage(group.id, '请调用 mcp__probe__ping 工具（参数传空对象），然后把工具返回的文本原样写出来。', { mentions: [bot.id] })
  await waitFor(() => cards().length > 0, 'external MCP tool asks before running')
  const card = cards()[0].message.card
  assert.ok(
    String(card.tool).includes('probe') || card.tool === 'codemode' || card.tool === 'mcp',
    `审批卡要带真实工具名，实际是 ${card.tool}`,
  )
  // 卡还没答之前工具不能执行：那说明审批被绕过了。
  assert.equal(toolRunsSince(0).length, 0, '没有回答之前外部工具不能执行')

  await engine.answerCard({ sessionRef: group.threadId, requestId: card.requestId, behavior: 'allow' })
  await waitFor(
    () => toolRunsSince(0).length > 0 || textSince(0, 'pong'),
    'allowed MCP tool runs and its output reaches the room',
  )

  // 第二回合：同样的调用，这次拒绝。工具不能再执行。
  const before = events.length
  await client.sendGroupMessage(group.id, '再调用一次 mcp__probe__ping（参数传空对象），把返回文本写出来。', { mentions: [bot.id] })
  await waitFor(() => cards().length > 1, 'second call asks again')
  const second = cards()[1].message.card
  await engine.answerCard({ sessionRef: group.threadId, requestId: second.requestId, behavior: 'deny' })
  // 给模型一点时间把“被拒绝”写进回合并收尾。
  await waitFor(
    () => events.slice(before).some(event => event.type === 'message' && event.message?.kind === 'turn'),
    'turn ends after a denied call',
  )
  assert.equal(toolRunsSince(before).length, 0, '拒绝之后这次调用不能再执行')
  console.log('mcp approval: 允许才会执行，拒绝不执行')
} finally {
  child.kill('SIGTERM')
  await sleep(200)
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
  process.exit(0)
}
