import assert from 'node:assert/strict'
import test from 'node:test'
import { createBodySwap } from './body-swap.js'
import { skillsForRole } from '../../../../shared/role-toolbox.js'

const member = (id, role, engine) => ({
  id,
  name: { lead: '规划师', worker: '执行官', verifier: '验收员' }[id],
  role,
  roleKind: role,
  station: '工位',
  approval: 'ask',
  permissions: { read: true, exec: role !== 'lead', write: role !== 'lead' },
  body: {
    kind: 'base',
    ref: `bot-${id}`,
    roomRef: `base-${id}`,
    sessionRef: `thread-${id}`,
    engine,
    model: 'old-model',
    spec: { prompt: `你是${id}`, skills: [], mcp: [] },
  },
})

const roomOf = () => ({
  id: 'room-1',
  name: '房间',
  goal: '做事',
  roomType: 'studio',
  state: 'paused',
  live: true,
  verify: 'test',
  acceptance: 'test -f a',
  chatRoom: { id: 'shared' },
  chatHost: { memberRef: 'host' },
  repoPath: '/tmp/room',
  worktrees: { worker: '/tmp/worker' },
  members: [member('lead', 'lead', 'claude'), member('worker', 'worker', 'pi'), member('verifier', 'verifier', 'pi')],
  independence: 'none',
  pauseReason: 'member_error',
  memberError: { memberId: 'worker', kind: 'auth' },
  turnQueue: [],
  approvals: [],
})

const harness = ({ authenticated, failPatch } = {}) => {
  let room = roomOf()
  const calls = { created: [], patched: [], messages: [], events: [], detached: [], attached: [], skills: [] }
  const store = {
    readRoom: () => room,
    updateRoom: (_id, mutator) => {
      const next = mutator(room)
      if (next !== null && Array.isArray(next.events)) calls.events.push(...next.events)
      return room
    },
    appendMessage: (_id, message) => calls.messages.push(message),
  }
  const engine = {
    instances: async () => [
      { id: 'claude', engine: 'claude', name: 'Claude', available: true, ...(authenticated === undefined ? {} : { authenticated }), capabilities: { approvalReview: true } },
      { id: 'pi', engine: 'pi', name: 'Pi', available: true, capabilities: { approvalReview: false } },
    ],
    createMemberBot: async input => {
      calls.created.push(input)
      return { id: 'bot-new', name: input.name, engine: 'claude', model: input.model ?? 'sonnet' }
    },
    patchMemberBot: async (id, payload) => {
      if (failPatch === true) throw new Error('base 409 /api/bots/x: {"error":"this channel is working — stop that turn first"}')
      calls.patched.push({ id, payload })
      return { id, threadId: 'thread-worker', engine: payload.modelSelection.instanceId, model: payload.modelSelection.model }
    },
    setBotSkills: async (id, skills) => calls.skills.push({ id, skills }),
  }
  const swap = createBodySwap({
    store,
    engine,
    emit: () => {},
    attachMember: async (_roomId, memberId) => calls.attached.push(memberId),
    detachMember: (_roomId, memberId) => calls.detached.push(memberId),
  })
  return { swap, calls, get room() { return room } }
}

test('a body without a spec cannot be swapped by model alone', async () => {
  const { swap, room } = harness()
  delete room.members.find(item => item.id === 'worker').body.spec
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /先补上行为说明/)
})

test('swapping keeps the member and its history, and replaces the body', async () => {
  const { swap, calls, room } = harness()
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, true, result.error)
  const worker = room.members.find(item => item.id === 'worker')
  assert.equal(worker.body.ref, 'bot-worker')
  assert.equal(worker.body.roomRef, 'base-worker')
  assert.equal(worker.body.sessionRef, 'thread-worker')
  assert.equal(worker.body.engine, 'claude')
  assert.equal(worker.body.model, 'sonnet')
  assert.equal(room.state, 'active')
  assert.equal(room.pauseReason, null)
  assert.equal(room.memberError, undefined)
  assert.equal(room.independence, 'vendor')
  assert.equal(calls.created.length, 0)
  assert.equal(calls.patched[0].id, 'bot-worker')
  assert.match(calls.patched[0].payload.soul, /你是worker/)
  assert.match(calls.messages.at(-1).text, /换好了身体/)
  assert.equal(calls.events.some(event => event.type === 'member.body.swapped'), true)
})

test('a personality-only change leaves the role toolbox alone', async () => {
  const { swap, calls, room } = harness()
  room.members.find(item => item.id === 'worker').body.spec.skills = skillsForRole('worker')
  const result = await swap.swap(room, {
    memberId: 'worker',
    engine: 'claude',
    model: 'sonnet',
    prompt: '发发发',
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(calls.skills.length, 0)
})

test('an old body with no skills gains the role toolbox', async () => {
  const { swap, calls, room } = harness()
  const result = await swap.swap(room, {
    memberId: 'worker',
    engine: 'claude',
    model: 'sonnet',
  })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(calls.skills[0].skills, skillsForRole('worker'))
})

test('the body carries an editable soul, skills and tools', async () => {
  const { swap, calls, room } = harness()
  const result = await swap.swap(room, {
    memberId: 'worker',
    engine: 'claude',
    model: 'sonnet',
    prompt: '只做复核，不解释。',
    skills: ['review'],
    mcp: ['github'],
  })
  assert.equal(result.ok, true, result.error)
  const worker = room.members.find(item => item.id === 'worker')
  assert.equal(worker.body.spec.prompt, '只做复核，不解释。')
  assert.deepEqual(worker.body.spec.skills, skillsForRole('worker'))
  assert.deepEqual(worker.body.spec.mcp, [
    { server: 'github', scopes: ['read'], approval: 'ask' },
    { server: 'chrome-devtools', scopes: ['read'], approval: 'ask' },
  ])
  assert.match(calls.patched[0].payload.soul, /只做复核，不解释/)
  assert.deepEqual(calls.skills[0].skills, skillsForRole('worker'))
  assert.deepEqual(calls.patched[0].payload.mcp.map(grant => grant.server), ['github', 'chrome-devtools'])
})

test('planner and verifier cannot add non-browser tools', async () => {
  const { swap } = harness()
  const result = await swap.swap(roomOf(), {
    memberId: 'verifier',
    engine: 'claude',
    model: 'sonnet',
    prompt: '你是验收员',
    mcp: ['github'],
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /只读浏览器/)
})

test('bad skill or tool names are refused', async () => {
  const { swap, calls } = harness()
  assert.match((await swap.swap(roomOf(), { memberId: 'worker', engine: 'claude', skills: ['bad name'] })).error, /技能名/)
  assert.match((await swap.swap(roomOf(), { memberId: 'worker', engine: 'claude', mcp: ['https://x'] })).error, /服务名/)
  assert.equal(calls.created.length, 0)
})

test('a model that never asks cannot become the body of an exec member', async () => {
  const { swap, calls } = harness()
  const result = await swap.swap(roomOf(), { memberId: 'worker', engine: 'pi', model: 'other-model' })
  assert.equal(result.ok, false)
  assert.match(result.error, /不会先问你/)
  assert.equal(calls.created.length, 0)
})

test('a logged-out model cannot become the new body', async () => {
  const { swap, calls } = harness({ authenticated: false })
  const result = await swap.swap(roomOf(), { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /还没登录/)
  assert.equal(calls.created.length, 0)
})

test('a busy chat room waits for the round to end', async () => {
  const { swap, calls } = harness()
  const room = { ...roomOf(), roomType: 'chat', chat: { running: true } }
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /等这一回合结束/)
  assert.equal(calls.created.length, 0)
})

test('a base that refuses the patch is reported in plain Chinese', async () => {
  const { swap } = harness({ failPatch: true })
  const result = await swap.swap(roomOf(), { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /等这一轮结束/)
  assert.doesNotMatch(result.error, /channel is working/)
})

test('a busy room keeps its body until the turn ends', async () => {
  const { swap, calls } = harness()
  const room = roomOf()
  room.busyMembers = ['worker']
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /等这一回合结束/)
  assert.equal(calls.created.length, 0)
})

test('a pending approval blocks the swap', async () => {
  const { swap, calls } = harness()
  const room = roomOf()
  room.approvals = [{ id: 'a1', memberId: 'worker', state: 'pending' }]
  const result = await swap.swap(room, { memberId: 'worker', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /待确认/)
  assert.equal(calls.created.length, 0)
})
