// 薄基座的 HTTP 契约：用 Lodge 自己的 base client 和 engine 适配器打一遍切片端点。
// 这里证明协议形状和三类边缘：审批卡往返、中断终态、SSE 断线重放。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'
import { createEngine } from '../server/engine.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', 'lodge-base-slice')
const port = 18000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db'), '--fake'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

// 原始 SSE 读取：只用来验证 last-event-id 重放，engine 不暴露游标。
const readSse = async ({ lastEventId = null, until = null, signal }) => {
  const response = await fetch(`${baseUrl}/api/events`, {
    headers: {
      accept: 'text/event-stream',
      ...(lastEventId === null ? {} : { 'last-event-id': lastEventId }),
    },
    signal,
  })
  assert.equal(response.ok, true)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frames = []
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const id = block.split('\n').find(line => line.startsWith('id:'))?.slice(3).trim() ?? null
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (data === '' || id === null) continue
      let frame
      try {
        frame = JSON.parse(data)
      } catch {
        continue
      }
      frames.push({ id, frame })
      if (until !== null && until(frames)) return frames
    }
  }
  return frames
}

try {
  await waitFor(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      return response.ok
    } catch {
      return false
    }
  }, 'health')

  const client = createBaseClient({ baseUrl })
  const engine = createEngine({ client })

  const instances = await client.instances()
  assert.equal(instances.instances[0].instanceId, 'fake')

  const bot = (await client.createBot({
    name: '验收员',
    modelSelection: { instanceId: 'fake', model: 'fake/echo' },
    settings: { toolScope: { deny: [] } },
  })).bot
  assert.equal(typeof bot.id, 'string')

  const bootstrap = await client.bootstrap()
  assert.ok(bootstrap.bots.some(item => item.id === bot.id))

  const group = (await client.createGroup({ name: '契约房', memberIds: [bot.id] })).group
  assert.equal(typeof group.id, 'string')
  assert.equal(typeof group.threadId, 'string')

  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: '契约',
    defaultResponder: { kind: 'member', botId: bot.id },
    followMentions: false,
  })
  await client.patchGroupTask(group.id, group.threadId, { title: '契约' })

  // holds 是投递边界：往返要真，被叫停的成员不能被一条消息重新叫起来。
  await client.setGroupHold(group.id, bot.id, true)
  const held = (await client.bootstrap()).groups.find(item => item.id === group.id)
  assert.equal(held?.holds?.[bot.id], true)
  await assert.rejects(() => client.sendGroupMessage(group.id, '被叫停'), /base 409/)
  await client.setGroupHold(group.id, bot.id, false)

  // 事件要经 engine 的归一化，才是 Lodge 真正消费的形状；只看原始帧会假绿。
  const events = []
  let connected = false
  const unsubscribe = engine.subscribe({
    roomId: group.id,
    sessionRef: group.threadId,
    onEvent: event => events.push(event),
    onState: state => { if (state.connected === true) connected = true },
  })
  await waitFor(() => connected, 'events connected')

  // 1. 普通回合：delta + 文本 + digest。
  const sent = await client.sendGroupMessage(group.id, '你好')
  assert.equal(typeof sent.message?.id, 'string')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.kind === 'text' && event.message.text === 'echo: 你好'),
    'echo text',
  )
  await waitFor(() => events.some(event => event.type === 'message' && event.message?.kind === 'turn'), 'echo digest')
  // digest 的耗时来自回合起点；写死 0 会让每个回合在界面上都显示 0.0s。
  const echoTurn = events.find(event => event.type === 'message' && event.message?.kind === 'turn')
  assert.equal(typeof echoTurn.message.turn?.durationMs, 'number', 'digest carries durationMs')
  assert.ok(echoTurn.message.turn.durationMs >= 0, 'durationMs is not negative')
  assert.ok(events.some(event => event.type === 'delta' && event.delta === 'echo: '), 'runtime delta reaches the engine')

  // 点名路由：群里有两位时，mentions 决定谁回答。
  const second = (await client.createBot({
    name: '第二位',
    modelSelection: { instanceId: 'fake', model: 'fake/echo' },
    settings: { toolScope: { deny: [] } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, second.id] })
  await client.sendGroupMessage(group.id, '点你', { mentions: [second.id] })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'echo: 点你' && event.message?.authorRef === second.id),
    'mentioned member answers',
  )

  // 没接入的驱动诚实失败，不静默换模型。
  const unsupported = (await client.createBot({
    name: '未接入',
    modelSelection: { instanceId: 'claude', model: '' },
    settings: { toolScope: { deny: [] } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, second.id, unsupported.id] })
  const beforeUnsupported = events.length
  await client.sendGroupMessage(group.id, '你来', { mentions: [unsupported.id] })
  await waitFor(
    () => events.slice(beforeUnsupported).some(event => event.type === 'message' && /还没有接入/.test(String(event.message?.text ?? ''))),
    'unsupported driver fails honestly',
  )

  // 2. 审批卡：真实工具名、回答前不结束、只能回答一次。
  await client.sendGroupMessage(group.id, '权限:bash')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.card?.requestType === 'permission'),
    'permission card',
  )
  const cardEvent = events.find(event => event.type === 'message' && event.message?.card?.requestType === 'permission')
  assert.equal(cardEvent.message.card.tool, 'bash')
  assert.equal(cardEvent.message.card.action, 'exec')
  assert.equal(cardEvent.message.text.includes('Allow'), false)
  const cardIndex = events.indexOf(cardEvent)
  await sleep(300)
  assert.equal(
    events.slice(cardIndex + 1).some(event => event.type === 'message' && event.message?.kind === 'turn'),
    false,
    'the turn waits for the answer',
  )
  const requestId = cardEvent.message.card.requestId
  await engine.answerCard({ sessionRef: group.threadId, requestId, behavior: 'allow' })
  await waitFor(
    () => events.slice(cardIndex).some(event => event.type === 'message' && event.message?.text === '已允许 bash'),
    'allowed turn text',
  )
  await waitFor(
    () => events.slice(cardIndex).some(event => event.type === 'message' && event.message?.kind === 'turn'),
    'allowed turn digest',
  )
  await assert.rejects(
    () => engine.answerCard({ sessionRef: group.threadId, requestId, behavior: 'allow' }),
    /base 404/,
  )

  // 3. 中断：有终态、没有后续正文、下一回合照常。
  const beforeInterrupt = events.length
  await client.sendGroupMessage(group.id, '慢')
  await sleep(200)
  await engine.interruptBot(bot.id)
  await waitFor(
    () => events.slice(beforeInterrupt).some(event => event.type === 'message' && event.message?.text === '已停下'),
    'interrupt terminal text',
  )
  const terminalIndex = events.findIndex(event => event.type === 'message' && event.message?.text === '已停下')
  await sleep(500)
  assert.equal(
    events.slice(terminalIndex + 1).some(event => event.type === 'message' && event.message?.kind === 'text'),
    false,
    'no text after the interrupt terminal state',
  )
  await client.sendGroupMessage(group.id, '再来')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'echo: 再来'),
    'turn after interrupt',
  )

  // 4. SSE 断线重放：只补缺失、顺序不变、id 单调。
  const firstController = new AbortController()
  const firstFrames = await readSse({
    until: list => list.some(item => item.frame.message?.text === 'echo: 你好'),
    signal: firstController.signal,
  })
  assert.ok(firstFrames.length > 0)
  const cursorId = firstFrames[firstFrames.length - 1].id
  assert.match(cursorId, /^[^:]+:\d+$/)
  firstController.abort()
  await sleep(100)

  await client.sendGroupMessage(group.id, '重放验证')
  await waitFor(async () => {
    const page = await client.threadMessages(group.threadId)
    return page.messages.some(message => message.text === 'echo: 重放验证')
  }, 'replay message in history')

  const secondController = new AbortController()
  const replayed = await readSse({
    lastEventId: cursorId,
    until: list => list.some(item => item.frame.message?.text === 'echo: 重放验证'),
    signal: secondController.signal,
  })
  secondController.abort()
  const cursorSeq = Number(cursorId.split(':').pop())
  const seqs = replayed.map(item => Number(item.id.split(':').pop()))
  assert.ok(seqs.every(seq => seq > cursorSeq), 'replay starts after the cursor')
  assert.deepEqual(seqs, [...new Set(seqs)], 'no duplicated frames')
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'frames keep their order')

  const messages = await client.threadMessages(group.threadId)
  assert.ok(messages.messages.length >= 1)

  unsubscribe()
  await client.patchGroup(group.id, { memberIds: [] })
  await client.deleteGroup(group.id)
  await client.deleteBot(bot.id)
  console.log('base-rs contract: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
