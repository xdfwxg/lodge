// pi 驱动映射：用 fake-pi 说同一套 RPC 帧，确定性地验证 delta、审批卡、中断。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'
import { createEngine } from '../server/engine.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', 'lodge-base-slice')
const fakePi = join(dir, 'fake-pi.mjs')
const port = 19500 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-pi-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const countFakePi = () => {
  try {
    return execFileSync('pgrep', ['-f', fakePi], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .length
  } catch (error) {
    return error?.status === 1 ? 0 : 0
  }
}

const waitFor = async (check, label, tries = 150) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db')],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, LODGE_PI_BIN: fakePi },
  },
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
  const bot = (await client.createBot({
    name: 'pi 成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: {
      soul: '你是小林，先找漏洞，再谈信心。',
      lease: { read: [], write: [], exec: false, network: [] },
    },
  })).bot
  const group = (await client.createGroup({ name: 'pi 契约房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
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
    onState: state => { if (state.connected === true) connected = true },
  })
  await waitFor(() => connected, 'events connected')

  // 普通回合：delta + 文本 + digest。
  await client.sendGroupMessage(group.id, 'hello')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'fake pi: hello'),
    'pi text',
  )
  await waitFor(() => events.some(event => event.type === 'message' && event.message?.kind === 'turn'), 'pi digest')
  assert.ok(events.some(event => event.type === 'delta' && event.delta === 'fake pi: hello'))

  // 每轮把房间最近的对话带给 pi；不是只给它这一条提示。
  await client.sendGroupMessage(group.id, '上下文')
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('房间最近的对话')
      && String(event.message?.text ?? '').includes('fake pi: hello')),
    'thread context reaches pi',
  )

  // 成员的 soul 作为 system prompt 交给 pi，角色和语气不丢。
  await client.sendGroupMessage(group.id, '系统')
  await waitFor(
    () => events.some(event => event.type === 'message' && String(event.message?.text ?? '').includes('你是小林')),
    'member soul reaches pi',
  )

  // 审批卡：真实工具名，回答后回合继续。
  await client.sendGroupMessage(group.id, '权限')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.card?.requestType === 'permission'),
    'pi permission card',
  )
  const cardEvent = events.find(event => event.type === 'message' && event.message?.card?.requestType === 'permission')
  assert.equal(cardEvent.message.card.tool, 'bash')
  await engine.answerCard({
    sessionRef: group.threadId,
    requestId: cardEvent.message.card.requestId,
    behavior: 'allow',
  })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === '已收到回答'),
    'pi continuation after answer',
  )
  await waitFor(
    () => events.filter(event => event.type === 'message' && event.message?.kind === 'turn').length >= 2,
    'pi digest after answer',
  )

  // 中断：终态 + 不再有正文；下一回合照常。
  const before = events.length
  await client.sendGroupMessage(group.id, '慢')
  await sleep(250)
  await engine.interruptBot(bot.id)
  await waitFor(
    () => events.slice(before).some(event => event.type === 'message' && event.message?.text === '已停下'),
    'pi interrupt terminal',
  )
  const terminal = events.findIndex(event => event.type === 'message' && event.message?.text === '已停下')
  await sleep(400)
  assert.equal(
    events.slice(terminal + 1).filter(event => event.type === 'message' && event.message?.kind === 'text').length,
    0,
    'no text after pi interrupt',
  )
  await client.sendGroupMessage(group.id, 'again')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'fake pi: again'),
    'pi turn after interrupt',
  )

  // 驱动失败：stderr 要进终态，不吞。
  const beforeFailure = events.length
  await client.sendGroupMessage(group.id, '失败')
  await waitFor(
    () => events.slice(beforeFailure).some(event => event.type === 'message' && /model request failed/.test(String(event.message?.text ?? ''))),
    'pi stderr reaches the terminal',
  )

  // prompt 被拒：立刻失败，不等超时。
  const beforeReject = events.length
  await client.sendGroupMessage(group.id, '拒绝')
  await waitFor(
    () => events.slice(beforeReject).some(event => event.type === 'message' && /compaction in progress/.test(String(event.message?.text ?? ''))),
    'pi prompt rejection surfaces',
  )

  // 正常结束也要收掉驱动进程组；不能每轮留一个 pi 在后台等输入。
  await waitFor(() => countFakePi() === 0, 'pi processes exit after turns', 80)

  unsubscribe()
  console.log('base-rs pi driver: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
