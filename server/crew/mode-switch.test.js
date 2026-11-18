import assert from 'node:assert/strict'
import test from 'node:test'
import { createModeSwitch } from './mode-switch.js'

const member = (id, role, roleKind) => ({
  id,
  name: id,
  role,
  roleKind,
  station: '工位',
  approval: 'ask',
  permissions: { read: true, exec: role !== 'lead', write: role !== 'lead' },
  body: {
    kind: 'base',
    ref: `bot-${id}`,
    roomRef: `group-${id}`,
    sessionRef: `thread-${id}`,
    engine: 'claude',
    model: 'sonnet',
    spec: { prompt: `你是${id}`, skills: [], mcp: [] },
  },
})

const room = overrides => ({
  id: 'room-1',
  name: 'Room',
  goal: '把说明补完整',
  roomType: 'studio',
  state: 'active',
  live: true,
  busyMembers: [],
  approvals: [],
  chatRoom: { id: 'group-chat' },
  chatHost: null,
  worktrees: {},
  members: [member('lead', 'lead', 'planner'), member('worker', 'worker', 'executor'), member('verifier', 'verifier', 'verifier')],
  ...overrides,
})

const setup = initial => {
  let current = initial
  const calls = { patches: [], created: [], members: [], attached: [], sent: [], deleted: [] }
  const store = {
    readRoom: () => current,
    updateRoom: (_id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (_id, message) => { calls.messages = [...(calls.messages ?? []), message] },
  }
  const engine = {
    createMemberBot: async input => {
      calls.created.push(input)
      return { id: 'bot-host', name: input.name }
    },
    patchMemberBot: async (id, payload) => {
      calls.patches.push({ id, payload })
      return { id, threadId: 'thread-1' }
    },
    updateRoomMembers: async (id, members) => calls.members.push({ id, members }),
    deleteMemberBot: async id => calls.deleted.push(id),
  }
  const live = {
    isAttached: () => false,
    detach: () => {},
    attach: async value => calls.attached.push(value),
    sendToMember: async (...args) => calls.sent.push(args),
    busyReview: () => false,
  }
  const mode = createModeSwitch({ store, engine, live, emit: () => {} })
  return { mode, calls, get room() { return current } }
}

test('studio → chat keeps every member thread and adds a host', async () => {
  const ctx = setup(room())
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'chat' })
  assert.equal(result.ok, true, result.error)
  assert.equal(ctx.room.roomType, 'chat')
  assert.equal(ctx.room.chatHost.memberRef, 'bot-host')
  assert.equal(ctx.room.members[0].body.ref, 'bot-lead')
  assert.equal(ctx.room.members[1].body.sessionRef, 'thread-worker')
  assert.equal(ctx.calls.patches.length, 3)
  assert.ok(ctx.calls.members[0].members.includes('bot-host'))
  assert.equal(ctx.calls.attached.length, 1)
})

test('chat → studio keeps the same bodies and starts a planner alignment', async () => {
  const chatMembers = [
    member('lead', 'lead', 'planner'),
    member('worker', 'worker', 'executor'),
    member('verifier', 'verifier', 'verifier'),
  ]
  const ctx = setup(room({
    roomType: 'chat',
    chat: { round: 1, phase: 'discussing' },
    chatHost: { memberRef: 'bot-host', name: 'LodgeHost' },
    members: chatMembers,
  }))
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'studio' })
  assert.equal(result.ok, true, result.error)
  assert.equal(ctx.room.roomType, 'studio')
  assert.equal(ctx.room.leadMemberId, 'lead')
  assert.equal(ctx.room.members[0].body.ref, 'bot-lead')
  assert.ok(ctx.room.stages.length >= 2)
  assert.equal(ctx.calls.sent[0][1], 'lead')
  assert.match(ctx.calls.sent[0][2], /目标：/)
})

test('chat → studio asks which members become the planner and verifier', async () => {
  const ctx = setup(room({
    roomType: 'chat',
    members: [member('a', 'worker', 'participant'), member('b', 'worker', 'participant')],
  }))
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'studio' })
  assert.equal(result.ok, false)
  assert.match(result.error, /先选一位成员做规划师/)
})

test('chat → studio promotes the picked members and keeps their threads', async () => {
  const ctx = setup(room({
    roomType: 'chat',
    members: [member('a', 'worker', 'participant'), member('b', 'worker', 'participant')],
  }))
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'studio', plannerId: 'a', verifierId: 'b' })
  assert.equal(result.ok, true, result.error)
  const roles = Object.fromEntries(ctx.room.members.map(item => [item.id, { role: item.role, roleKind: item.roleKind }]))
  assert.deepEqual(roles.a, { role: 'lead', roleKind: 'planner' })
  assert.deepEqual(roles.b, { role: 'verifier', roleKind: 'verifier' })
  assert.equal(ctx.room.members[0].body.ref, 'bot-a')
  assert.equal(ctx.room.members[1].body.sessionRef, 'thread-b')
  assert.equal(ctx.room.leadMemberId, 'a')
  assert.match(ctx.calls.patches[0].payload.soul, /规划师/)
})

test('chat → studio refuses the same member for both roles', async () => {
  const ctx = setup(room({
    roomType: 'chat',
    members: [member('a', 'worker', 'participant'), member('b', 'worker', 'participant')],
  }))
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'studio', plannerId: 'a', verifierId: 'a' })
  assert.equal(result.ok, false)
  assert.match(result.error, /不能是同一位/)
})

test('a busy room cannot switch modes', async () => {
  const ctx = setup(room({ busyMembers: ['worker'] }))
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'chat' })
  assert.equal(result.ok, false)
  assert.match(result.error, /回合/)
})

test('an unknown mode is refused', async () => {
  const ctx = setup(room())
  const result = await ctx.mode.switchMode(ctx.room, { mode: 'other' })
  assert.equal(result.ok, false)
  assert.match(result.error, /聊天室或工作室/)
})
