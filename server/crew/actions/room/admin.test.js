import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminActions } from './admin.js'

const setup = (over, {
  retireRoomBots = async () => {},
  patches = [],
  patchMemberBot = async (ref, input) => { patches.push({ ref, input }) },
  health = async () => ({ ok: true, networkModes: ['proxy', 'model', 'none'] }),
} = {}) => {
  let room = {
    id: 'room-1',
    name: '一间房',
    state: 'active',
    live: false,
    archivedAt: null,
    activeRoundId: null,
    workRound: { status: 'stopped' },
    ...over,
  }
  const stopped = []
  const deleted = []
  const cancelled = []
  const messages = []
  const actions = createAdminActions({
    store: {
      cancelWork: id => { cancelled.push(id) },
      appendMessage: (id, message) => { messages.push(message) },
      readRoom: () => room,
    },
    engine: { patchMemberBot, health },
    live: {
      isAttached: () => false,
      detach: () => {},
      cancel: async () => ({}),
      retireRoomBots,
    },
    emit: () => {},
    roomFiles: { roomDir: () => '' },
    files: { remove: () => {} },
    memberAdd: {},
    memberRemove: {},
    stopRound: async ({ room: target }) => {
      stopped.push(target.id)
      room = { ...room, state: 'stopped', activeRoundId: null, workRound: { status: 'stopped' } }
      return { ok: true }
    },
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const next = structuredClone(room)
      const change = mutate(next)
      if (change === null || change === undefined || change === false) return null
      room = next
      return room
    },
    deleteRoom: id => {
      deleted.push(id)
      return true
    },
  })
  return { actions, room: () => room, stopped, deleted, cancelled, messages, patches }
}

test('a room policy reaches every member and is saved', async () => {
  const ctx = setup({
    members: [{
      id: 'lead',
      name: '规划师',
      role: 'lead',
      roleKind: 'planner',
      station: '拆解',
      permissions: { read: true },
      body: { ref: 'bot-lead', engine: 'pi', model: 'm', spec: { prompt: '你是规划师', mcp: [] } },
    }],
  })
  const result = await ctx.actions.permissions({
    room: ctx.room(),
    readBody: async () => ({ policy: { files: 'confirm', network: 'model', external: 'ask' } }),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.patches.map(item => item.ref), ['bot-lead'])
  assert.equal(ctx.patches[0].input.approval, 'ask')
  assert.equal(ctx.patches[0].input.network, 'model')
  assert.equal(ctx.room().policy.network, 'model')
  assert.equal(ctx.room().members[0].approval, 'ask')
  assert.match(ctx.messages.at(-1).text, /权限调好了/)
})

test('model-only is refused when the base cannot enforce it', async () => {
  const ctx = setup({
    members: [{
      id: 'lead',
      name: '规划师',
      role: 'lead',
      roleKind: 'planner',
      station: '拆解',
      permissions: { read: true },
      body: { ref: 'bot-lead', engine: 'pi', model: 'm', spec: { prompt: '你是规划师', mcp: [] } },
    }],
  }, { health: async () => ({ ok: true, networkModes: ['proxy', 'none'] }) })
  const result = await ctx.actions.permissions({
    room: ctx.room(),
    readBody: async () => ({ policy: { network: 'model' } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /还不支持/)
  assert.deepEqual(ctx.patches, [])
  assert.equal(ctx.room().policy, undefined)
})

const memberOf = engine => ({
  id: 'lead',
  name: '规划师',
  role: 'lead',
  roleKind: 'planner',
  station: '拆解',
  permissions: { read: true },
  body: { ref: 'bot-lead', engine, model: 'm', spec: { prompt: '你是规划师', mcp: [] } },
})

test('an engine that cannot scope tools keeps asking even when the room says direct', async () => {
  const claude = setup({ members: [memberOf('claude')] })
  const first = await claude.actions.permissions({
    room: claude.room(),
    readBody: async () => ({ policy: { files: 'direct', network: 'proxy', external: 'auto' } }),
  })
  assert.equal(first.ok, true)
  assert.equal(claude.patches[0].input.approval, 'ask')
  assert.equal(claude.room().members[0].approval, 'ask')

  const pi = setup({ members: [memberOf('pi')] })
  const second = await pi.actions.permissions({
    room: pi.room(),
    readBody: async () => ({ policy: { files: 'direct', network: 'proxy', external: 'auto' } }),
  })
  assert.equal(second.ok, true)
  assert.equal(pi.patches[0].input.approval, 'auto')
})

test('model-only is refused when a member engine cannot scope the network', async () => {
  const ctx = setup({ members: [memberOf('claude')] })
  const result = await ctx.actions.permissions({
    room: ctx.room(),
    readBody: async () => ({ policy: { network: 'model' } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /不支持/)
  assert.deepEqual(ctx.patches, [])
})

test('a member that cannot be patched leaves the old policy in place', async () => {
  const ctx = setup({
    members: [{
      id: 'lead',
      name: '规划师',
      role: 'lead',
      roleKind: 'planner',
      station: '拆解',
      permissions: { read: true },
      body: { ref: 'bot-lead', engine: 'pi', model: 'm', spec: { prompt: '你是规划师', mcp: [] } },
    }],
  }, { patchMemberBot: async () => { throw new Error('基座没应答') } })
  const result = await ctx.actions.permissions({
    room: ctx.room(),
    readBody: async () => ({ policy: { external: 'ask' } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /有成员没更新/)
  assert.equal(ctx.room().policy, undefined)
})

test('a partial patch rolls the patched members back', async () => {
  const members = [
    { ...memberOf('pi'), id: 'a', name: '甲', body: { ref: 'bot-a', engine: 'pi', model: 'm', spec: { prompt: 'a', mcp: [] } } },
    { ...memberOf('pi'), id: 'b', name: '乙', body: { ref: 'bot-b', engine: 'pi', model: 'm', spec: { prompt: 'b', mcp: [] } } },
  ]
  const seen = []
  const ctx = setup({
    members,
    policy: { files: 'direct', network: 'proxy', external: 'ask' },
  }, {
    patchMemberBot: async (ref, input) => {
      seen.push({ ref, approval: input.approval })
      if (ref === 'bot-b' && input.approval === 'auto') throw new Error('基座没应答')
    },
  })
  const result = await ctx.actions.permissions({
    room: ctx.room(),
    readBody: async () => ({ policy: { files: 'direct', network: 'proxy', external: 'auto' } }),
  })
  assert.equal(result.ok, false)
  // 甲先落到 auto，乙失败后把甲退回原来的 ask；房间策略保持不变。
  assert.deepEqual(seen, [
    { ref: 'bot-a', approval: 'auto' },
    { ref: 'bot-b', approval: 'auto' },
    { ref: 'bot-a', approval: 'ask' },
  ])
  assert.equal(ctx.room().policy.external, 'ask')
})

test('archiving stops a round that the stale menu snapshot could not see', async () => {
  const ctx = setup({ workRound: { status: 'active' } })
  const stale = { id: 'room-1', state: 'active', live: false, activeRoundId: null, workRound: { status: 'stopped' } }
  const result = await ctx.actions.archive({ room: stale, readBody: async () => ({}) })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.stopped, ['room-1'])
  assert.equal(typeof ctx.room().archivedAt, 'number')
  assert.equal(ctx.room().activeRoundId, null)
  assert.equal(ctx.room().state, 'stopped')
})

test('archiving clears a leftover round pointer without stopping again', async () => {
  const ctx = setup({ activeRoundId: 'round-9', workRound: { status: 'completed' } })
  await ctx.actions.archive({ room: ctx.room(), readBody: async () => ({}) })
  assert.deepEqual(ctx.stopped, [])
  assert.equal(ctx.room().activeRoundId, null)
  assert.equal(typeof ctx.room().archivedAt, 'number')
})

test('a room stays when the base could not retire its bots', async () => {
  const ctx = setup({}, { retireRoomBots: async () => { throw new Error('base 500 /api/bots/x: boom') } })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, false)
  assert.match(result.error, /基座没能清理这个房间的成员/)
  assert.deepEqual(ctx.deleted, [])
})

test('an archived room can be deleted even with a leftover round pointer', async () => {
  const ctx = setup({ archivedAt: 1, state: 'stopped', activeRoundId: 'round-9', workRound: { status: 'active' } })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.deleted, ['room-1'])
})

test('a studio with an open round still cannot be deleted before stopping', async () => {
  const ctx = setup({ state: 'active', activeRoundId: 'round-1', workRound: { status: 'active' } })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, false)
  assert.deepEqual(ctx.deleted, [])
})

test('a concluded chat room is deleted directly, without archiving first', async () => {
  const ctx = setup({
    roomType: 'chat',
    state: 'active',
    activeRoundId: 'round-1',
    workRound: { status: 'active' },
    chat: { phase: 'concluded', running: false, hostThinking: false },
  })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.deleted, ['room-1'])
})

test('a chat round that is still running cannot be deleted', async () => {
  const ctx = setup({ roomType: 'chat', state: 'active', chat: { phase: 'discussing', running: true } })
  const result = await ctx.actions.delete({ room: ctx.room() })
  assert.equal(result.ok, false)
  assert.deepEqual(ctx.deleted, [])
})

test('archiving stops an active promise and cancels its tick', async () => {
  const ctx = setup({
    promise: { text: '每周挑 5 个项目', status: 'active', nextAt: 123, version: 1 },
  })
  await ctx.actions.archive({ room: ctx.room(), readBody: async () => ({}) })
  assert.equal(ctx.room().promise.status, 'stopped')
  assert.equal(ctx.room().promise.stoppedReason, 'archived')
  assert.deepEqual(ctx.cancelled, ['promise.tick:room-1:123:1'])
})

test('unarchiving leaves the promise stopped', async () => {
  const ctx = setup({
    archivedAt: 1,
    promise: { text: '每周挑 5 个项目', status: 'stopped', nextAt: 123, version: 1, stoppedReason: 'archived' },
  })
  await ctx.actions.archive({ room: ctx.room(), readBody: async () => ({ archived: false }) })
  assert.equal(ctx.room().archivedAt, null)
  assert.equal(ctx.room().live, true)
  assert.equal(ctx.room().promise.status, 'stopped')
  assert.equal(ctx.cancelled.length, 0)
})

test('deleting a room cancels its promise tick', async () => {
  const ctx = setup({
    state: 'stopped',
    promise: { text: '每周挑 5 个项目', status: 'stopped', nextAt: 123, version: 1 },
  })
  await ctx.actions.delete({ room: ctx.room() })
  assert.deepEqual(ctx.cancelled, ['promise.tick:room-1:123:1'])
})
