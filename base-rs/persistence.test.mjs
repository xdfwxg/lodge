// 持久化与隔离：杀掉基座后回合补失败终态；停一个成员不影响别的线程；用量只有一份账本。
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
const port = 19000 + Math.floor(Math.random() * 500)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-persist-'))
const dbPath = join(dataDir, 'base.db')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const start = () => spawn(
  bin,
  ['--port', String(port), '--db', dbPath, '--fake'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

const healthy = async () => {
  try {
    return (await fetch(`${baseUrl}/api/health`)).ok
  } catch {
    return false
  }
}

const messagesOf = async (client, threadId) => (await client.threadMessages(threadId)).messages

let child = start()
try {
  await waitFor(healthy, 'health')

  const client = createBaseClient({ baseUrl })
  const bot = (await client.createBot({
    name: '把式',
    modelSelection: { instanceId: 'fake', model: 'fake/echo' },
    settings: { lease: { read: ['/tmp'], write: [], exec: false, network: [] } },
  })).bot
  const group = (await client.createGroup({ name: '持久房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: '持久',
    defaultResponder: { kind: 'member', botId: bot.id },
    followMentions: false,
  })

  // 一个慢回合跑到一半，基座被强杀。
  await client.sendGroupMessage(group.id, '慢')
  await sleep(300)
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
  await sleep(200)

  child = start()
  await waitFor(healthy, 'health after restart')

  // 重启后：回合补了失败终态，历史和用量还在。
  await waitFor(async () => {
    const messages = await messagesOf(client, group.threadId)
    return messages.some(message => String(message.text ?? '').includes('基座重启'))
  }, 'failed turn after restart')
  const history = await messagesOf(client, group.threadId)
  const digest = history.find(message => message.kind === 'digest')
  assert.ok(digest, 'digest survives restart')
  assert.match(String(digest.digest?.reply ?? ''), /基座重启/)
  assert.ok(digest.digest?.usage, 'usage ledger is on the digest')
  const ids = history.map(message => message.id)
  assert.equal(new Set(ids).size, ids.length, 'message ids are stable and unique')

  // 线程还能继续跑。
  await client.sendGroupMessage(group.id, '再来')
  await waitFor(async () => {
    const messages = await messagesOf(client, group.threadId)
    return messages.some(message => message.text === 'echo: 再来')
  }, 'turn after restart')

  // 取消按线程隔离：慢回合被停，另一个群照常完成。
  const secondBot = (await client.createBot({
    name: '另一位',
    modelSelection: { instanceId: 'fake', model: 'fake/echo' },
    settings: { lease: { read: [], write: [], exec: false, network: [] } },
  })).bot
  const second = (await client.createGroup({ name: '另一间', memberIds: [secondBot.id] })).group
  await client.setupGroup(second.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: '另一间',
    defaultResponder: { kind: 'member', botId: secondBot.id },
    followMentions: false,
  })
  await client.sendGroupMessage(group.id, '慢')
  await sleep(150)
  const runningGroup = (await client.bootstrap()).groups.find(item => item.id === group.id)
  assert.equal(runningGroup?.working, true, 'the group reports working while a turn runs')
  await client.interruptBot(bot.id)
  await client.sendGroupMessage(second.id, '这边继续')
  await waitFor(async () => {
    const messages = await messagesOf(client, second.threadId)
    return messages.some(message => message.text === 'echo: 这边继续')
  }, 'unrelated thread keeps running')
  await waitFor(async () => {
    const messages = await messagesOf(client, group.threadId)
    return messages.some(message => message.text === '已停下')
  }, 'interrupted turn terminal')

  const afterStop = await messagesOf(client, group.threadId)
  const stopIndex = afterStop.findIndex(message => message.text === '已停下')
  assert.equal(
    afterStop.slice(stopIndex + 1).filter(message => message.kind === 'text').length,
    0,
    'no text after the interrupt terminal',
  )
  const stoppedGroup = (await client.bootstrap()).groups.find(item => item.id === group.id)
  assert.equal(stoppedGroup?.working, false, 'the group clears working after the terminal')

  // 审批卡在 SSE 断线后仍能回答：卡和等待者不在连接上。
  const engine = createEngine({ client })
  const firstSeen = []
  let firstConnected = false
  const off = engine.subscribe({
    roomId: group.id,
    sessionRef: group.threadId,
    onEvent: event => firstSeen.push(event),
    onState: state => { if (state.connected === true) firstConnected = true },
  })
  await waitFor(() => firstConnected, 'events for card')
  await client.sendGroupMessage(group.id, '权限:bash')
  await waitFor(
    () => firstSeen.some(event => event.message?.card?.requestType === 'permission'),
    'card before disconnect',
  )
  const pending = firstSeen.find(event => event.message?.card?.requestType === 'permission').message.card
  off()
  await sleep(150)

  const secondSeen = []
  let secondConnected = false
  const offAgain = engine.subscribe({
    roomId: group.id,
    sessionRef: group.threadId,
    onEvent: event => secondSeen.push(event),
    onState: state => { if (state.connected === true) secondConnected = true },
  })
  await waitFor(() => secondConnected, 'events after reconnect')
  await engine.answerCard({
    sessionRef: group.threadId,
    requestId: pending.requestId,
    behavior: 'allow',
  })
  await waitFor(
    () => secondSeen.some(event => event.message?.text === '已允许 bash'),
    'answer after SSE disconnect',
  )
  offAgain()

  console.log('base-rs persistence: ok')
} finally {
  child.kill('SIGKILL')
  rmSync(dataDir, { recursive: true, force: true })
}
