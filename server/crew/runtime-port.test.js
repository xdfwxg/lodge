import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEngine } from '../engine.js'
import {
  RUNTIME_EVENT,
  RUNTIME_METHODS,
  RUNTIME_NAMESPACES,
  assertRuntimePort,
  supportsRuntime,
} from './runtime-port.js'

const root = fileURLToPath(new URL('.', import.meta.url))
const walk = dir => readdirSync(join(root, dir)).flatMap(name => {
  const path = join(dir, name)
  return statSync(join(root, path)).isDirectory() ? walk(path) : [path]
})

const completeRuntime = () => {
  const runtime = {}
  for (const name of RUNTIME_METHODS) runtime[name] = () => ({})
  runtime.capabilities = () => ({ streaming: true })
  runtime.mcp = Object.fromEntries(
    RUNTIME_NAMESPACES.mcp.map(name => [name, () => ({})]),
  )
  return runtime
}

test('the runtime port validates methods, namespaces and capabilities', () => {
  const runtime = completeRuntime()
  assert.equal(assertRuntimePort(runtime), runtime)
  assert.equal(supportsRuntime(runtime, 'streaming'), true)
  assert.equal(supportsRuntime(runtime, 'mentions'), false)

  const missingMethod = completeRuntime()
  delete missingMethod.sendTurn
  assert.throws(() => assertRuntimePort(missingMethod), /缺少方法：sendTurn/)

  const missingMcp = completeRuntime()
  delete missingMcp.mcp.remove
  assert.throws(() => assertRuntimePort(missingMcp), /mcp\.remove/)

  const noCapabilities = completeRuntime()
  delete noCapabilities.capabilities
  assert.throws(() => assertRuntimePort(noCapabilities), /缺少方法：capabilities/)

  const badCapabilities = completeRuntime()
  badCapabilities.capabilities = () => null
  assert.throws(() => assertRuntimePort(badCapabilities), /必须返回对象/)
})

test('every runtime method used by crew is declared in the port', () => {
  const declared = new Set([...RUNTIME_METHODS, ...Object.keys(RUNTIME_NAMESPACES)])
  const used = new Map()
  for (const file of walk('.')) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    const text = readFileSync(join(root, file), 'utf8')
    for (const match of text.matchAll(/(?<!\.)\bengine\.([A-Za-z_$][\w$]*)/g)) {
      if (!used.has(match[1])) used.set(match[1], file)
    }
  }
  for (const [name, file] of used) {
    assert.equal(declared.has(name), true, `${file} calls engine.${name}, which the runtime port does not declare`)
  }
})

const fakeClient = () => {
  const watched = []
  return {
    watched,
    bootstrap: async () => ({
      bots: [{ id: 'b1', name: '甲', modelSelection: { instanceId: 'i1', model: 'm1' } }],
      groups: [{
        id: 'g1',
        threadId: 't1',
        defaultResponder: { botId: 'b1' },
        tasks: [{ title: '目标' }],
        working: true,
        busyBotId: 'b1',
        queue: [{ botId: 'b1', state: 'queued', position: 1, of: 2, waitingForBotId: 'b2' }],
        holds: {},
        unread: true,
        cwd: '/tmp/room',
        usage: { turns: 2, costUsd: 0.5, input: 10, output: 20 },
      }],
    }),
    threadMessages: async () => ({
      messages: [
        { id: 'm0', role: 'user', text: '你好', at: 1 },
        { id: 'm1', role: 'agent', kind: 'activity', at: 2, tool: { label: "甲's read", name: 'Read', ok: true, itemId: 'i1', input: {} } },
        { id: 'm2', role: 'agent', kind: 'digest', at: 3, digest: { turnId: 't1', durationMs: 1200, reply: '完成', toolCalls: 2 } },
      ],
    }),
    sendGroupMessage: async (groupId, text, { sendId } = {}) => ({
      message: { id: 'base-message', sendId },
    }),
    interruptBot: async () => {},
    instances: async () => ({ instances: [] }),
    watchEvents: async ({ onFrame, onState }) => {
      watched.push({ onFrame, onState })
    },
  }
}

test('the adapter exposes normalized rooms, history, turns and events', async () => {
  const client = fakeClient()
  const engine = assertRuntimePort(createEngine({ client }))

  const rooms = await engine.rooms()
  assert.deepEqual(rooms[0], {
    id: 'g1',
    name: undefined,
    sessionRef: 't1',
    goal: '目标',
    working: true,
    busyRef: 'b1',
    queue: [{ memberRef: 'b1', state: 'queued', position: 1, of: 2, waitingForRef: 'b2' }],
    holds: {},
    heldMessages: {},
    tasks: [{ title: '目标' }],
    unread: true,
    cwd: '/tmp/room',
    usage: {
      turns: 2,
      costMicroUsd: 500_000,
      tokens: { input: 10, output: 20, cachedInput: 0 },
    },
  })

  const { messages } = await engine.history('t1')
  assert.equal(messages[0].kind, 'text')
  assert.equal(messages[0].text, '你好')
  assert.equal(messages[1].kind, 'activity')
  assert.equal(messages[1].text, 'read')
  assert.equal(messages[2].kind, 'turn')
  assert.equal(messages[2].turn.reply, '完成')

  const sent = await engine.sendTurn({ roomId: 'g1', text: '@甲 做事', sendId: 's1' })
  assert.deepEqual(sent, {
    accepted: true,
    messageId: 'base-message',
    sendId: 's1',
    queued: false,
    queueId: null,
    threadId: null,
  })

  const cancelled = await engine.cancelTurn({ roomId: 'g1' })
  assert.deepEqual(cancelled, { cancelled: true })

  const events = []
  const states = []
  const off = engine.subscribe({
    roomId: 'g1',
    sessionRef: 't1',
    onEvent: event => events.push(event),
    onState: state => states.push(state),
  })
  assert.equal(typeof off, 'function')
  await Promise.resolve()
  const watcher = client.watched[0]
  watcher.onState({ connected: true, error: null })
  watcher.onFrame({
    kind: 'runtime',
    event: { threadId: 't1', type: 'content.delta', streamKind: 'assistant_text', delta: '你', turnId: 'turn-1' },
  })
  watcher.onFrame({ kind: 'runtime', event: { threadId: 'other', type: 'content.delta', streamKind: 'assistant_text', delta: '忽略' } })
  watcher.onFrame({ kind: 'message', threadId: 't1', message: { id: 'm3', role: 'user', text: '继续', at: 4 } })
  watcher.onFrame({ kind: 'group', group: { id: 'g1', threadId: 't1', working: false } })

  assert.deepEqual(states, [{ connected: true, error: null }])
  assert.deepEqual(events.map(event => event.type), [
    RUNTIME_EVENT.delta,
    RUNTIME_EVENT.message,
    RUNTIME_EVENT.room,
  ])
  assert.equal(events[0].turnId, 'turn-1')
  assert.equal(events[1].message.text, '继续')
  assert.equal(events[2].room.id, 'g1')
  assert.equal(events[2].room.working, false)
  off()
})

test('failure results are explicit and createRoom cleans up a half-created group', async () => {
  const calls = []
  const base = fakeClient()
  const client = {
    ...base,
    cancelGroupQueue: async () => { throw new Error('base 404 /api/groups/g1/queue/q1') },
    steerGroupQueue: async () => ({ steered: true, messages: [{ id: 'm1' }], queueIds: ['q1'] }),
    respondToCard: async input => { calls.push(input); return { ok: true } },
    config: async () => { throw new Error('config down') },
    createGroup: async () => ({ group: { id: 'g2', threadId: 't2' } }),
    setupGroup: async () => { throw new Error('setup down') },
    deleteGroup: async id => { calls.push({ deleteGroup: id }) },
  }
  const engine = assertRuntimePort(createEngine({ client }))
  assert.deepEqual(await engine.cancelRoomQueue('g1', 'q1'), { cancelled: false, reason: '这条排队消息已经不在队列里' })
  assert.deepEqual(await engine.steerRoomQueue('g1', 'q1'), { outcome: 'steered', messageIds: ['m1'], queueIds: ['q1'] })
  client.steerGroupQueue = async () => { throw new Error('base 409 conflict') }
  assert.equal((await engine.steerRoomQueue('g1', 'q1')).outcome, 'refused')
  client.steerGroupQueue = async () => { throw new Error('connection reset') }
  assert.equal((await engine.steerRoomQueue('g1', 'q1')).outcome, 'indeterminate')
  await assert.rejects(() => engine.answerCard({ requestId: 'r1', behavior: 'allow' }), /缺少线程/)
  await assert.rejects(() => engine.answerCard({ sessionRef: 't1', requestId: 'r1', behavior: 'maybe' }), /allow/)
  await assert.rejects(() => engine.answerCard({ sessionRef: 't1', requestId: 'r1', behavior: 'answer', message: ' ' }), /答案/)
  assert.deepEqual(await engine.answerCard({ sessionRef: 't1', requestId: 'r1', behavior: 'allow' }), { ok: true })
  assert.deepEqual(await engine.features(), { skillsLibrary: false })
  await assert.rejects(() => engine.createRoom({ name: 'x', goal: 'g', members: ['b1'], cwd: '/tmp', leadId: 'b1' }), /setup down/)
  assert.deepEqual(calls.filter(item => item.deleteGroup === 'g2'), [{ deleteGroup: 'g2' }])
})

test('an unavailable engine falls back explicitly with a reason', async () => {
  const client = {
    ...fakeClient(),
    instances: async () => ({
      instances: [{
        instanceId: 'i1',
        driverKind: 'claudeAgent',
        snapshot: { state: 'available' },
        models: { default: 'm1', options: [{ id: 'm1' }] },
        capabilities: { streaming: true },
      }],
    }),
    createBot: async input => { client.created = input; return { bot: { id: 'b2', name: '乙' } } },
  }
  const engine = assertRuntimePort(createEngine({ client }))
  const member = await engine.createMemberBot({ name: '乙', engine: 'claude-cli', model: 'missing-model' })
  assert.equal(member.fallback, true)
  assert.match(member.reason, /已回退 m1/)
  assert.deepEqual(client.created.modelSelection, { instanceId: 'i1', model: 'm1' })
})
