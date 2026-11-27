import assert from 'node:assert/strict'
import test from 'node:test'
import { actionForTool } from '../../shared/tool-action.js'
import { createEngine } from '../engine.js'

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
      return { bot: { id: 'member-1', name: payload.name } }
    },
    patchBot: async (id, payload) => {
      captured.botPatch = { id, payload }
      return { bot: { id, threadId: 'thread-1', modelSelection: payload.modelSelection } }
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
    setGroupHold: async (groupId, botId, held) => {
      captured.hold = { groupId, botId, held }
      return { ok: true }
    },
    steerGroupQueue: async () => ({ steered: true, messages: [{ id: 'm1' }], queueIds: ['q1'] }),
    setBotSkills: async (botId, skills) => {
      captured.skills = { botId, skills }
      return { assignedSkills: skills }
    },
  }
}

test('member prompts and semantic capability settings cross the engine port', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  const member = await engine.createMemberBot({
    name: 'PlannerAbc',
    soul: '你是队长',
    description: '规划',
    approval: 'ask',
    cwd: '/work/planner',
    mcp: [{ server: 'github', approval: 'ask' }],
  })

  assert.equal(member.id, 'member-1')
  assert.equal(client.captured.bot.name, 'PlannerAbc')
  assert.equal(client.captured.bot.soul, undefined)
  assert.equal(client.captured.bot.settings.soul, '你是队长')
  assert.equal(client.captured.bot.settings.description, '规划')
  // 工作副本跟着成员走，不能落在房间群里某个人的目录上。
  assert.equal(client.captured.bot.settings.cwd, '/work/planner')
  assert.equal(client.captured.bot.settings.approvalMode, 'ask')
  assert.deepEqual(client.captured.bot.settings.mcpServers, ['github'])
  assert.deepEqual(client.captured.bot.settings.toolScope, { deny: ['mcp:agents:*'] })
  assert.equal(engine.capabilities().mcp, true)
  assert.equal(engine.capabilities().cancel, true)
  assert.equal(engine.capabilities().schedules, false)
})

test('a pi member carries the tool grant and the workspace-consented servers', async () => {
  const client = fakeClient()
  client.instances = async () => ({ instances: [{
    instanceId: 'pi',
    driverKind: 'pi',
    snapshot: { state: 'available' },
    models: { default: 'm', options: [{ id: 'm' }] },
  }] })
  const engine = createEngine({ client })
  await engine.createMemberBot({
    name: 'Worker',
    engine: 'pi',
    model: '',
    approval: 'auto',
    mcp: [{ server: 'desktop', approval: 'auto' }],
    autoMcpServers: ['desktop'],
    nativeTools: ['read', 'bash'],
    budget: { toolCalls: 1000, maxMs: 1000 },
  })
  assert.deepEqual(client.captured.bot.settings.mcpServers, ['desktop'])
  assert.deepEqual(client.captured.bot.settings.autoMcpServers, ['desktop'])
  assert.deepEqual(client.captured.bot.settings.nativeTools, ['read', 'bash'])
})

test('private member threads deliver messages but carry the private flag', () => {
  let onFrame = null
  const client = { ...fakeClient(), watchEvents: ({ onFrame: receive }) => { onFrame = receive } }
  const engine = createEngine({ client })
  const events = []
  const stop = engine.subscribe({
    roomId: 'group-1',
    sessionRef: 'chat-1',
    sessionRefs: ['private-1'],
    onEvent: event => events.push(event),
  })
  onFrame({ kind: 'message', threadId: 'private-1', message: { id: 'm1', kind: 'text', text: '盲评内容', from: { botId: 'b1' } } })
  onFrame({ kind: 'message', threadId: 'chat-1', message: { id: 'm2', kind: 'text', text: '公开内容', from: { botId: 'b1' } } })
  onFrame({ kind: 'message', threadId: 'other', message: { id: 'm3', kind: 'text', text: '别人的线程', from: { botId: 'b1' } } })
  stop()
  assert.equal(events.length, 2)
  assert.equal(events[0].private, true)
  // 私有线程的事件带自己的线程号：权限卡要在那条线程上回答。
  assert.equal(events[0].sessionRef, 'private-1')
  assert.equal(events[0].message.text, '盲评内容')
  assert.equal(events[1].private, undefined)
  assert.equal(events[1].message.text, '公开内容')
})

test('a role tool scope is merged with the base agents deny', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  await engine.createMemberBot({
    name: 'Worker',
    soul: '你是执行官',
    toolScope: { deny: ['mcp:lodge_gate:*'] },
  })
  assert.deepEqual(client.captured.bot.settings.toolScope, {
    deny: ['mcp:agents:*', 'mcp:lodge_gate:*'],
  })
})

test('a body patch keeps semantic fields on this side of the port', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  const result = await engine.patchMemberBot('bot-1', {
    soul: '新性格',
    description: '工位',
    approval: 'ask',
    mcp: [{ server: 'github', approval: 'ask' }],
    roomTools: ['lodge_gate'],
    modelSelection: { instanceId: 'pi', model: 'deepseek/deepseek-flash' },
  })
  assert.equal(result.threadId, 'thread-1')
  assert.deepEqual(client.captured.botPatch.payload, {
    soul: '新性格',
    description: '工位',
    approvalMode: 'ask',
    mcpServers: ['github', 'lodge_gate'],
    toolScope: { deny: ['mcp:agents:*'] },
    modelSelection: { instanceId: 'pi', model: 'deepseek/deepseek-flash' },
  })
})

test('room holds cross the engine port as a member reference', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  await engine.setRoomHold('group-1', 'member-1', true)
  assert.deepEqual(client.captured.hold, { groupId: 'group-1', botId: 'member-1', held: true })
})

test('member skills cross the engine port as base skill names', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  assert.deepEqual(await engine.setBotSkills('member-1', ['evidence-review']), {
    ok: true,
    assignedSkills: ['evidence-review'],
  })
  assert.deepEqual(client.captured.skills, { botId: 'member-1', skills: ['evidence-review'] })
})

test('feature switches come from the base config and fail closed', async () => {
  const on = createEngine({ client: { config: async () => ({ features: { skillsLibrary: true } }) } })
  assert.deepEqual(await on.features(), { skillsLibrary: true })
  const off = createEngine({ client: { config: async () => ({ features: {} }) } })
  assert.deepEqual(await off.features(), { skillsLibrary: false })
  const broken = createEngine({ client: { config: async () => { throw new Error('offline') } } })
  assert.deepEqual(await broken.features(), { skillsLibrary: false })
})

test('cancelling a queued room message reports whether it was still there', async () => {
  const sent = createEngine({ client: { cancelGroupQueue: async () => ({ ok: true }) } })
  assert.deepEqual(await sent.cancelRoomQueue('group-1', 'q1'), { cancelled: true })
  const gone = createEngine({ client: { cancelGroupQueue: async () => { throw new Error('base 404 no such queued message') } } })
  assert.equal((await gone.cancelRoomQueue('group-1', 'q1')).cancelled, false)
})

test('steering a queued room message keeps three outcomes distinct', async () => {
  const steered = createEngine({ client: fakeClient() })
  assert.deepEqual(await steered.steerRoomQueue('group-1', 'q1'), {
    outcome: 'steered',
    messageIds: ['m1'],
    queueIds: ['q1'],
  })

  const queued = createEngine({ client: { steerGroupQueue: async () => ({ queued: true }) } })
  assert.equal((await queued.steerRoomQueue('group-1', 'q1')).outcome, 'refused')

  const refused = createEngine({ client: { steerGroupQueue: async () => { throw new Error('base 409 only the first queued message can steer') } } })
  assert.equal((await refused.steerRoomQueue('group-1', 'q1')).outcome, 'refused')

  const unknown = createEngine({ client: { steerGroupQueue: async () => { throw new Error('socket hang up') } } })
  assert.equal((await unknown.steerRoomQueue('group-1', 'q1')).outcome, 'indeterminate')
})

test('exact mention ids cross the engine port with the text', async () => {
  const calls = []
  const engine = createEngine({
    client: {
      sendGroupMessage: async (...args) => {
        calls.push(args)
        return { message: { id: 'm1', sendId: 's1' } }
      },
    },
  })
  const result = await engine.sendTurn({ roomId: 'group-1', text: '@Exec go', mentions: ['bot-1'] })
  assert.deepEqual(calls[0], ['group-1', '@Exec go', { sendId: undefined, mentions: ['bot-1'] }])
  assert.equal(result.messageId, 'm1')
})

test('room tools are mounted next to external MCP grants', async () => {
  const client = fakeClient()
  const engine = createEngine({ client })
  await engine.createMemberBot({
    name: 'PlannerAbc',
    approval: 'ask',
    mcp: [{ server: 'github', approval: 'ask' }],
    roomTools: ['lodge-planner-room-abc123'],
  })
  assert.deepEqual(client.captured.bot.settings.mcpServers, ['github', 'lodge-planner-room-abc123'])
})

test('a member engine binds to an available runtime instance', async () => {
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
  const member = await engine.createMemberBot({ name: 'Executor', engine: 'codex-cli' })
  assert.equal(member.engine, 'codex')
  assert.equal(member.model, 'gpt-5.6-sol')
  assert.equal(member.fallback, false)
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
  const member = await engine.createMemberBot({ name: 'Executor', engine: 'pi-cli', model: 'deepseekAnthropic/deepseek-flash' })
  assert.equal(member.engine, 'pi')
  assert.equal(member.model, 'deepseekAnthropic/deepseek-flash')
  assert.equal(member.fallback, false)
  assert.equal(client.captured.bot.modelSelection.instanceId, 'pi')
  assert.equal(client.captured.bot.modelSelection.model, 'deepseekAnthropic/deepseek-flash')
})

test('a CLI engine with no model list uses its own configured default', async () => {
  const client = fakeClient()
  client.instances = async () => ({
    instances: [{
      instanceId: 'claude',
      driverKind: 'claude',
      displayName: 'Claude Code',
      snapshot: { state: 'available' },
      models: { default: '', options: [] },
      capabilities: { approvalReview: false },
    }],
  })
  const engine = createEngine({ client })
  const member = await engine.createMemberBot({ name: 'Chat', engine: 'claude' })
  assert.equal(member.engine, 'claude')
  assert.equal(member.model, '')
  assert.equal(member.fallback, false)
  assert.deepEqual(client.captured.bot.modelSelection, { instanceId: 'claude', model: '' })
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
  const member = await engine.createMemberBot({ name: 'Executor', engine: 'pi', model: 'unknown/model' })
  assert.equal(member.fallback, true)
  assert.equal(member.model, 'deepseekAnthropic/deepseek-v4-pro')
  assert.match(member.reason, /不在.*可选列表/)
})

test('an unavailable member engine falls back explicitly', async () => {
  const client = fakeClient()
  client.instances = async () => ({ instances: [] })
  const engine = createEngine({ client })
  const member = await engine.createMemberBot({ name: 'Executor', engine: 'grok-cli' })
  assert.equal(member.engine, 'claude')
  assert.equal(member.fallback, true)
  assert.equal(member.requestedEngine, 'grok-cli')
  assert.match(member.reason, /grok-cli/)
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
    followMentions: false,
  })

  assert.deepEqual(room, { id: 'group-1', sessionRef: 'thread-1' })
  assert.deepEqual(client.captured.group.memberIds, ['planner', 'executor', 'verifier'])
  assert.equal(client.captured.setup.payload.defaultResponder.botId, 'planner')
  assert.deepEqual(client.captured.setup.payload.defaultResponder, { kind: 'member', botId: 'planner' })
  assert.equal(client.captured.setup.payload.followMentions, false)
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
  assert.equal(actionForTool('WebFetch'), 'exec')
  assert.equal(actionForTool('mcp__github__create_issue'), 'exec')
  assert.equal(actionForTool('mcp__github__list_issues'), 'exec')
  assert.equal(actionForTool('lodge_gate:submit_verdict'), 'gate')
  assert.equal(actionForTool('mcp__lodge_gate__submit_decision'), 'gate')
})

test('question cards keep the base choices as options', async () => {
  const client = {
    threadMessages: async () => ({
      messages: [{
        id: 'q1',
        at: 1,
        kind: 'question',
        text: 'Which file?',
        card: { requestId: 'ask-1', requestType: 'question', tool: 'ask_user', choices: ['README', 'Guide'] },
      }],
    }),
  }
  const engine = createEngine({ client })
  const { messages } = await engine.history('thread-1')
  assert.equal(messages[0].kind, 'question')
  assert.deepEqual(messages[0].card.options, ['README', 'Guide'])
  assert.equal(messages[0].card.tool, 'ask_user')
})

test('member texts carry their turn identity across the engine port', async () => {
  const client = {
    threadMessages: async () => ({
      messages: [
        // runtime 只给 turnId、不标收尾：当作完整发言，不当成过场。
        { id: 'm0', at: 1, kind: 'text', role: 'bot', text: '只有回合。', turnId: 'turn-0', from: { botId: 'bot-1' } },
        { id: 'm1', at: 2, kind: 'text', role: 'bot', text: '我先看下。', turnId: 'turn-1', turnTerminal: false, from: { botId: 'bot-1' } },
        { id: 'm2', at: 3, kind: 'text', role: 'bot', text: '结论是…', turnId: 'turn-1', turnTerminal: true, from: { botId: 'bot-1' } },
      ],
    }),
  }
  const engine = createEngine({ client })
  const { messages } = await engine.history('thread-1')
  assert.deepEqual(messages.map(({ kind, text, turnId, turnFinal }) => ({ kind, text, turnId, turnFinal })), [
    { kind: 'text', text: '只有回合。', turnId: 'turn-0', turnFinal: undefined },
    { kind: 'text', text: '我先看下。', turnId: 'turn-1', turnFinal: false },
    { kind: 'text', text: '结论是…', turnId: 'turn-1', turnFinal: true },
  ])
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
  assert.deepEqual(captured, ['thread-1', 'r1', 'deny', undefined])
  assert.deepEqual(await engine.answerCard({ sessionRef: 'thread-1', requestId: 'r1', behavior: 'answer', message: '选 A' }), { ok: true })
  assert.deepEqual(captured, ['thread-1', 'r1', 'answer', '选 A'])
  await assert.rejects(engine.answerCard({ sessionRef: 'thread-1', requestId: 'r1', behavior: 'answer' }), /需要一个答案/)
  await assert.rejects(engine.answerCard({ sessionRef: 'thread-1', requestId: 'r1', behavior: 'maybe' }), /allow、deny 或 answer/)
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

test('an activity carries the tool step for the room status', async () => {
  const client = {
    threadMessages: async () => ({
      messages: [{
        id: 'a1',
        at: 1,
        kind: 'activity',
        tool: { name: 'Bash', ok: true, step: { activity: 'command', target: 'pip', detail: 'pip install opencv' }, spoken: 'running a command' },
      }],
    }),
  }
  const engine = createEngine({ client })
  const { messages } = await engine.history('thread-1')
  assert.equal(messages[0].kind, 'activity')
  assert.equal(messages[0].tool.step.target, 'pip')
  assert.equal(messages[0].tool.spoken, 'running a command')
})

test('an explicit CREW_MODEL override wins over the base default bot, loudly', async () => {
  const saved = { instance: process.env.CREW_MODEL_INSTANCE, model: process.env.CREW_MODEL }
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    delete process.env.CREW_MODEL_INSTANCE
    delete process.env.CREW_MODEL
    const baseClient = fakeClient()
    await createEngine({ client: baseClient }).createMemberBot({
      name: '默认',
      budget: { toolCalls: 200, maxMs: 1_800_000 },
    })
    assert.deepEqual(baseClient.captured.bot.modelSelection, { instanceId: 'claude', model: 'claude-sonnet-5' })

    process.env.CREW_MODEL_INSTANCE = 'pi'
    process.env.CREW_MODEL = 'deepseek/deepseek-flash'
    const overrideClient = fakeClient()
    await createEngine({ client: overrideClient }).createMemberBot({
      name: '覆盖',
      budget: { toolCalls: 200, maxMs: 1_800_000 },
    })
    assert.deepEqual(overrideClient.captured.bot.modelSelection, { instanceId: 'pi', model: 'deepseek/deepseek-flash' })
    // 预算只在执行它的驱动上传；base 默认模型那条路不带这个字段。
    assert.deepEqual(overrideClient.captured.bot.settings.budget, { toolCalls: 200, maxMs: 1_800_000 })
    assert.equal(baseClient.captured.bot.settings.budget, undefined)
    assert.ok(
      warnings.some(line => line.includes('CREW_MODEL_INSTANCE') && line.includes('覆盖基座默认模型')),
      'the silent override becomes a startup warning',
    )
  } finally {
    console.warn = warn
    if (saved.instance === undefined) delete process.env.CREW_MODEL_INSTANCE
    else process.env.CREW_MODEL_INSTANCE = saved.instance
    if (saved.model === undefined) delete process.env.CREW_MODEL
    else process.env.CREW_MODEL = saved.model
  }
})

test('pi members carry the sandbox declarations from the product layer', async () => {
  const captured = {}
  const client = {
    instances: async () => ({
      instances: [{
        instanceId: 'pi',
        driverKind: 'pi',
        snapshot: { state: 'available' },
        models: { default: 'pi/default', options: [{ id: 'pi/default' }] },
      }],
    }),
    createBot: async payload => {
      captured.bot = payload
      return { bot: { id: 'pi-1', name: payload.name } }
    },
    patchBot: async (id, payload) => {
      captured.patch = payload
      return { bot: { id, threadId: 'thread-1', modelSelection: payload.modelSelection } }
    },
  }
  const engine = createEngine({ client })
  await engine.createMemberBot({
    name: 'Pi',
    engine: 'pi',
    profile: 'strict',
    limits: { fileBytes: 1024, processes: 8 },
    network: 'proxy',
  })
  assert.equal(captured.bot.settings.profile, 'strict')
  assert.deepEqual(captured.bot.settings.limits, { fileBytes: 1024, processes: 8 })
  assert.equal(captured.bot.settings.network, 'proxy')

  await engine.patchMemberBot('pi-1', {
    modelSelection: { instanceId: 'pi', model: 'pi/default' },
    profile: 'standard',
    limits: { fileBytes: 2048, processes: 16 },
    network: 'none',
  })
  assert.equal(captured.patch.profile, 'standard')
  assert.deepEqual(captured.patch.limits, { fileBytes: 2048, processes: 16 })
  assert.equal(captured.patch.network, 'none')
})
