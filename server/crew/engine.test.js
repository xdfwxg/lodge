import assert from 'node:assert/strict'
import test from 'node:test'
import { actionForTool, createEngine } from '../engine.js'

const fakeClient = () => {
  const captured = { bot: null, group: null, setup: null, task: null }
  return {
    captured,
    bootstrap: async () => ({
      bots: [{ id: 'bot-1', name: 'MausBot', modelSelection: { instanceId: 'claude', model: 'claude-sonnet-5' } }],
      groups: [],
    }),
    createBot: async payload => {
      captured.bot = payload
      return { bot: { id: 'seat-1', name: payload.name } }
    },
    createGroup: async payload => {
      captured.group = payload
      return { group: { id: 'group-1', threadId: 'thread-1' } }
    },
    setupGroup: async (id, payload) => {
      captured.setup = { id, payload }
    },
    patchGroupTask: async (id, threadId, payload) => {
      captured.task = { id, threadId, payload }
    },
    deleteGroup: async () => {},
  }
}

test('seat prompts and semantic capability settings cross the engine port', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  const seat = await engine.createSeatBot({
    name: 'PlannerAbc',
    soul: '你是队长',
    description: '规划',
    approval: 'ask',
    mcp: [{ server: 'github', scopes: ['read'], approval: 'ask' }],
  })

  assert.equal(seat.id, 'seat-1')
  assert.equal(client.captured.bot.name, 'PlannerAbc')
  assert.equal(client.captured.bot.soul, undefined)
  assert.equal(client.captured.bot.settings.soul, '你是队长')
  assert.equal(client.captured.bot.settings.description, '规划')
  assert.equal(client.captured.bot.settings.approvalMode, 'ask')
  assert.deepEqual(client.captured.bot.settings.mcpServers, ['github'])
  assert.equal(engine.capabilities().mcp, true)
  assert.equal(engine.capabilities().cancel, true)
  assert.equal(engine.capabilities().skills, false)
  assert.equal(engine.capabilities().schedules, false)
})

test('room tools are mounted next to external MCP grants', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  await engine.createSeatBot({
    name: 'PlannerAbc',
    approval: 'ask',
    mcp: [{ server: 'github', scopes: ['read'], approval: 'ask' }],
    roomTools: ['lodge-planner-room-abc123'],
  })
  assert.deepEqual(client.captured.bot.settings.mcpServers, ['github', 'lodge-planner-room-abc123'])
})

test('a seat engine binds to an available runtime instance', async () => {
  const client = fakeClient()
  client.instances = async () => ({
    instances: [{
      instanceId: 'codex',
      driverKind: 'codex',
      displayName: 'Codex',
      snapshot: { state: 'available' },
      models: { default: 'gpt-5.6-sol', options: [] },
      capabilities: { approvalReview: false },
    }],
  })
  const engine = createEngine({ client })
  const seat = await engine.createSeatBot({ name: 'Executor', engine: 'codex-cli' })
  assert.equal(seat.engine, 'codex')
  assert.equal(seat.model, 'gpt-5.6-sol')
  assert.equal(seat.fallback, false)
  assert.equal(client.captured.bot.modelSelection.instanceId, 'codex')
  assert.equal(client.captured.bot.modelSelection.model, 'gpt-5.6-sol')
})

test('pi-cli binds to a piAgent instance', async () => {
  const client = fakeClient()
  client.instances = async () => ({
    instances: [{
      instanceId: 'pi',
      driverKind: 'piAgent',
      displayName: 'Pi',
      snapshot: { state: 'available' },
      models: { default: 'deepseekAnthropic/deepseek-v4-pro', options: [{ id: 'deepseekAnthropic/deepseek-flash', label: 'Flash' }] },
      capabilities: { approvalReview: false },
    }],
  })
  const engine = createEngine({ client })
  const seat = await engine.createSeatBot({ name: 'Executor', engine: 'pi-cli', model: 'deepseekAnthropic/deepseek-flash' })
  assert.equal(seat.engine, 'pi')
  assert.equal(seat.model, 'deepseekAnthropic/deepseek-flash')
  assert.equal(seat.fallback, false)
  assert.equal(client.captured.bot.modelSelection.instanceId, 'pi')
  assert.equal(client.captured.bot.modelSelection.model, 'deepseekAnthropic/deepseek-flash')
})

test('an unoffered model falls back explicitly instead of silently switching', async () => {
  const client = fakeClient()
  client.instances = async () => ({
    instances: [{
      instanceId: 'pi',
      driverKind: 'piAgent',
      displayName: 'Pi',
      snapshot: { state: 'available' },
      models: { default: 'deepseekAnthropic/deepseek-v4-pro', options: [{ id: 'deepseekAnthropic/deepseek-flash', label: 'Flash' }] },
      capabilities: {},
    }],
  })
  const engine = createEngine({ client })
  const seat = await engine.createSeatBot({ name: 'Executor', engine: 'pi', model: 'unknown/model' })
  assert.equal(seat.fallback, true)
  assert.equal(seat.model, 'deepseekAnthropic/deepseek-v4-pro')
  assert.match(seat.reason, /不在.*可选列表/)
})

test('an unavailable seat engine falls back explicitly', async () => {
  const client = fakeClient()
  client.instances = async () => ({ instances: [] })
  const engine = createEngine({ client })
  const seat = await engine.createSeatBot({ name: 'Executor', engine: 'grok-cli' })
  assert.equal(seat.engine, 'claude')
  assert.equal(seat.fallback, true)
  assert.equal(seat.requestedEngine, 'grok-cli')
  assert.match(seat.reason, /grok-cli/)
  assert.equal(client.captured.bot.modelSelection.instanceId, 'claude')
})

test('room creation maps semantic members and lead to the runtime group', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  const room = await engine.createRoom({
    name: 'Room',
    goal: 'ship it',
    bulletin: 'goal: ship it',
    members: ['planner', 'executor', 'verifier'],
    cwd: '/tmp/room',
    leadId: 'planner',
  })

  assert.deepEqual(room, { id: 'group-1', sessionRef: 'thread-1' })
  assert.deepEqual(client.captured.group.memberIds, ['planner', 'executor', 'verifier'])
  assert.equal(client.captured.setup.payload.defaultResponder.botId, 'planner')
  assert.deepEqual(client.captured.setup.payload.defaultResponder, { kind: 'member', botId: 'planner' })
  assert.equal(client.captured.task.payload.title, 'ship it')
})

test('cancelTurn interrupts the busy bot in the room', async () => {
  let captured = null
  const client = {
    bootstrap: async () => ({
      bots: [{ id: 'bot-1', name: 'MausBot', modelSelection: { instanceId: 'claude', model: 'claude-sonnet-5' } }],
      groups: [{ id: 'room-1', name: 'Room', threadId: 'thread-1', busyBotId: 'bot-1', memberIds: ['bot-1'], usage: { turns: 1, costUsd: 0 } }],
    }),
    interruptBot: async (botId, body) => {
      captured = { botId, body }
    },
  }
  const engine = createEngine({ client })
  const result = await engine.cancelTurn({ roomId: 'room-1' })
  assert.equal(result.cancelled, true)
  assert.deepEqual(captured, { botId: 'bot-1', body: { threadId: 'thread-1' } })
})

test('permission cards cross the engine port with a semantic action', async () => {
  const client = {
    threadMessages: async () => ({
      messages: [{
        id: 'm1',
        at: 1,
        kind: 'options',
        card: { requestId: 'r1', requestType: 'permission', tool: 'Write', subtitle: 'forbidden.txt', options: ['Allow', 'Deny'] },
      }],
    }),
  }
  const engine = createEngine({ client })
  const { messages } = await engine.history('thread-1')
  assert.equal(messages[0].kind, 'question')
  assert.deepEqual(messages[0].card, {
    requestId: 'r1',
    requestType: 'permission',
    tool: 'Write',
    action: 'write',
    subtitle: 'forbidden.txt',
    options: ['Allow', 'Deny'],
  })
  assert.equal(actionForTool('Bash'), 'exec')
  assert.equal(actionForTool('Read'), 'read')
  assert.equal(actionForTool('WebFetch'), null)
})

test('answerCard forwards the decision to the runtime thread', async () => {
  let captured = null
  const client = {
    respondToCard: async (...args) => {
      captured = args
      return { ok: true }
    },
  }
  const engine = createEngine({ client })
  assert.deepEqual(await engine.answerCard({ sessionRef: 'thread-1', requestId: 'r1', behavior: 'deny' }), { ok: true })
  assert.deepEqual(captured, ['thread-1', 'r1', 'deny'])
  await assert.rejects(engine.answerCard({ sessionRef: 'thread-1', requestId: 'r1', behavior: 'maybe' }), /allow\/deny/)
  assert.equal(engine.capabilities().approvals, true)
})

test('cancelTurn reports when the room is not running', async () => {
  const client = {
    bootstrap: async () => ({
      bots: [{ id: 'bot-1', name: 'MausBot', modelSelection: { instanceId: 'claude', model: 'claude-sonnet-5' } }],
      groups: [{ id: 'room-1', name: 'Room', threadId: 'thread-1', memberIds: ['bot-1'], usage: { turns: 0, costUsd: 0 } }],
    }),
  }
  const engine = createEngine({ client })
  const result = await engine.cancelTurn({ roomId: 'room-1' })
  assert.equal(result.cancelled, false)
  assert.match(result.reason, /没有正在跑的回合/)
})
