// 真实 pi 冒烟（会调用模型，按需运行）：普通回合 + 中断终态。
// 用法：npm run base:rs:pi:real
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
const port = 20500 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-pi-real-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 300) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db')],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

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
  const instances = await client.instances()
  const pi = instances.instances.find(instance => instance.instanceId === 'pi')
  assert.ok(pi, 'pi is discovered')
  assert.equal(pi.snapshot.state, 'available', 'pi is available')
  console.log(`pi real: ${pi.version ?? 'version unknown'} ${pi.models?.default ?? ''}`)

  const bot = (await client.createBot({
    name: '真实 pi',
    modelSelection: { instanceId: 'pi', model: pi.models?.default ?? '' },
    settings: { lease: { read: [], write: [], exec: false, network: [] } },
  })).bot
  const group = (await client.createGroup({ name: '真实 pi 房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: 'pi 冒烟',
    defaultResponder: { kind: 'member', botId: bot.id },
    followMentions: false,
  })

  await client.sendGroupMessage(group.id, 'Reply with exactly: ok')
  await waitFor(async () => {
    const messages = (await client.threadMessages(group.threadId)).messages
    return messages.some(message => message.kind === 'text' && /ok/i.test(String(message.text ?? '')))
  }, 'real pi reply', 600)
  const first = (await client.threadMessages(group.threadId)).messages
  const reply = first.find(message => message.kind === 'text')
  const digest = first.find(message => message.kind === 'digest')
  assert.ok(digest?.digest?.usage, 'digest carries usage')
  console.log(`real pi reply: ${String(reply.text).slice(0, 120)} (in=${digest.digest.usage.input} out=${digest.digest.usage.output})`)

  // 严格档的真实回合：假 HOME + 读白名单下，引擎仍要能登录、调模型。
  const strictBot = (await client.createBot({
    name: '严格成员',
    modelSelection: { instanceId: 'pi', model: pi.models?.default ?? '' },
    settings: { profile: 'strict', lease: { read: [], write: [], exec: false, network: [] } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, strictBot.id] })
  const beforeStrict = (await client.threadMessages(group.threadId)).messages.length
  await client.sendGroupMessage(group.id, 'Reply with exactly: ok', { mentions: [strictBot.id] })
  await waitFor(async () => {
    const messages = (await client.threadMessages(group.threadId)).messages
    return messages.slice(beforeStrict).some(message => message.kind === 'text' && /ok/i.test(String(message.text ?? '')))
  }, 'strict pi reply', 900)

  await client.sendGroupMessage(
    group.id,
    'Write a 3000 word essay about the history of tea. Do not stop early.',
  )
  await sleep(1200)
  await engine.interruptBot(bot.id)
  await waitFor(async () => {
    const messages = (await client.threadMessages(group.threadId)).messages
    return messages.some(message => message.text === '已停下')
  }, 'real pi interrupt terminal')
  const after = (await client.threadMessages(group.threadId)).messages
  const stop = after.findIndex(message => message.text === '已停下')
  assert.equal(
    after.slice(stop + 1).filter(message => message.kind === 'text').length,
    0,
    'no text after real pi interrupt',
  )
  console.log('base-rs real pi: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
