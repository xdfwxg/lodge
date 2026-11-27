// 无副作用重试：模型服务一个字都没给出就断了，基座重发一次；有输出的回合不重试。
// fake-pi 的「重试一次」模式：第一次直接退出，第二次正常回一句。
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
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19900 + Math.floor(Math.random() * 90)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-retry-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// 上一次没跑完留下的标记会让假 pi 直接成功，先清掉。
rmSync(join(tmpdir(), 'lodge-fake-pi-retry.marker'), { force: true })

const waitFor = async (check, label, tries = 150) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, LODGE_PI_BIN: fakePi, LODGE_SANDBOX: 'off' },
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
  const bot = (await client.createBot({
    name: 'pi 成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { soul: '安静', lease: { read: [], write: [], exec: false, network: [] } },
  })).bot
  const group = (await client.createGroup({ name: '重试房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: tmpdir(),
    bulletin: 'pi',
    defaultResponder: { kind: 'member', botId: bot.id },
    followMentions: false,
  })

  const events = []
  let connected = false
  const unsubscribe = engine.subscribe({
    roomId: group.id,
    sessionRef: group.threadId,
    onEvent: event => events.push(event),
    onState: state => { if (state?.connected === true) connected = true },
  })
  await waitFor(() => connected, 'events connected')

  await engine.sendTurn({ roomId: group.id, text: '重试一次', sendId: 'retry-1' })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.kind === 'turn'),
    '回合终态',
    300,
  )
  const digest = events.find(event => event.type === 'message' && event.message?.kind === 'turn').message
  // 第一次一个字节都没给：重发一次之后成功，终态是 completed 而不是 failed。
  assert.equal(digest.turn?.stopReason, 'completed', `unexpected outcome: ${JSON.stringify(digest.turn)}`)
  assert.match(String(digest.turn?.reply ?? ''), /第二次成功/)
  // 重试对房间是看得见的：时间线上多一行 activity。
  assert.ok(
    events.some(event => event.type === 'message'
      && event.message?.kind === 'activity'
      && event.message?.tool?.name === 'retry'),
    '应该有一条“重试”的活动消息',
  )
  unsubscribe?.()
} finally {
  child.kill('SIGTERM')
  await sleep(200)
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(join(tmpdir(), 'lodge-fake-pi-retry.marker'), { force: true })
  // SSE 长连接会挂住事件循环；这个契约跑完就退出。
  process.exit(0)
}
