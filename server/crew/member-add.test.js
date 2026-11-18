import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemberAdd } from './member-add.js'

const member = (id, role, engine) => ({
  id,
  name: { lead: '规划师', worker: '执行官', verifier: '验收员' }[id],
  role,
  roleKind: role === 'worker' ? 'executor' : role,
  name_: undefined,
  permissions: { read: true, exec: role !== 'lead', write: role === 'worker' },
  body: { ref: `bot-${id}`, roomRef: `base-${id}`, sessionRef: `thread-${id}`, engine, model: 'm' },
})

const roomOf = () => ({
  id: 'room-x',
  name: '房间',
  goal: '做事',
  roomType: 'studio',
  state: 'active',
  live: true,
  verify: 'test',
  acceptance: 'test -f a',
  chatRoom: { id: 'shared' },
  chatHost: null,
  sourceRepo: '/tmp/src',
  repoPath: '/tmp/room',
  worktrees: { lead: '/wt/lead', worker: '/wt/worker', verifier: '/wt/verifier' },
  ports: {},
  workspaceEnv: {},
  branches: {},
  workspace: { provider: 'git', capabilities: {} },
  members: [member('lead', 'lead', 'claude'), member('worker', 'worker', 'pi'), member('verifier', 'verifier', 'pi')],
  independence: 'none',
  turnQueue: [],
  approvals: [],
})

const harness = ({ failCreate = false } = {}) => {
  let room = roomOf()
  const calls = { members: [], retired: [], workspaces: [], env: [], shared: [], messages: [], events: [], attached: [] }
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
      { id: 'claude', engine: 'claude', name: 'Claude', available: true, authenticated: true, models: { default: 'sonnet', options: [{ id: 'sonnet' }] }, capabilities: { approvalReview: true } },
      { id: 'pi', engine: 'pi', name: 'Pi', available: true, authenticated: true, models: { default: 'flash', options: [{ id: 'flash' }] }, capabilities: { approvalReview: false } },
    ],
    createMemberBot: async input => {
      calls.members.push(input)
      return { id: 'bot-new', name: input.name, engine: 'claude', model: input.model ?? 'sonnet' }
    },
    createRoom: async () => {
      if (failCreate) throw new Error('base down')
      return { id: 'base-new', sessionRef: 'thread-new' }
    },
    setBotSkills: async () => {},
    updateRoomMembers: async (id, refs) => calls.shared.push({ id, refs }),
    deleteRoom: async () => {},
    deleteMemberBot: async id => calls.retired.push(id),
  }
  const workspace = {
    provider: () => ({
      addMember: ({ member: spec }) => {
        calls.workspaces.push(spec.id)
        return { path: `/wt/${spec.id}`, branch: `crew/x/${spec.id}`, port: 4321, environment: { copied: [], linked: [], warnings: [] } }
      },
      removeMember: ({ member: spec }) => calls.retired.push(`ws-${spec.id}`),
    }),
    writeMemberEnv: input => calls.env.push(input),
  }
  const add = createMemberAdd({
    store,
    engine,
    emit: () => {},
    workspace,
    attachMember: async (_roomId, memberId) => calls.attached.push(memberId),
  })
  return { add, calls, get room() { return room } }
}

test('adding an executor appends a member with a body and a station', async () => {
  const { add, calls, room } = harness()
  const result = await add.add(room, { role: 'executor', name: '执行官二号', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, true, result.error)
  assert.equal(room.members.length, 4)
  const added = room.members.at(-1)
  assert.equal(added.id, 'worker-2')
  assert.equal(added.name, '执行官二号')
  assert.equal(added.role, 'worker')
  assert.equal(added.roleKind, 'executor')
  assert.equal(added.body.ref, 'bot-new')
  assert.equal(added.body.engine, 'claude')
  assert.equal(added.engine, undefined)
  assert.equal(added.prompt, undefined)
  assert.equal(added.skills, undefined)
  assert.equal(room.worktrees['worker-2'], '/wt/worker-2')
  assert.ok(calls.shared.some(call => call.refs.includes('bot-new')))
  assert.deepEqual(calls.attached, ['worker-2'])
  assert.equal(calls.events.some(event => event.type === 'member.added'), true)
  assert.match(calls.messages.at(-1).text, /加了一位执行官：执行官二号/)
  assert.match(calls.members[0].soul, /你是执行官二号/)
  assert.match(added.body.spec.prompt, /你是执行官二号/)
  assert.deepEqual(added.body.spec.skills, [])
})

test('a delivered room refuses new members', async () => {
  const { add, calls, room } = harness()
  room.stages = [{ title: '实现', state: 'passed' }]
  const result = await add.add(room, { role: 'executor', name: '执行官二号', engine: 'claude', model: 'sonnet' })
  assert.equal(result.ok, false)
  assert.match(result.error, /已经交付/)
  assert.equal(room.members.length, 3)
  assert.equal(calls.members.length, 0)
})

test('a second planner is refused: the room keeps one main bot', async () => {
  const { add, calls } = harness()
  const result = await add.add(roomOf(), { role: 'planner', name: '规划师二号' })
  assert.equal(result.ok, false)
  assert.match(result.error, /只能添加执行官或验收员/)
  assert.equal(calls.members.length, 0)
})

test('duplicate names and unready models are refused before anything is created', async () => {
  const { add, calls } = harness()
  assert.match((await add.add(roomOf(), { role: 'worker', name: '执行官' })).error, /同名成员/)
  const pi = await add.add(roomOf(), { role: 'worker', name: '执行官二号', engine: 'pi' })
  assert.equal(pi.ok, false)
  assert.match(pi.error, /会先问你/)
  assert.equal(calls.members.length, 0)
  assert.equal(calls.workspaces.length, 0)
})

test('a failed incarnation removes the new station and body', async () => {
  const { add, calls } = harness({ failCreate: true })
  const result = await add.add(roomOf(), { role: 'verifier', name: '验收员二号', engine: 'claude' })
  assert.equal(result.ok, false)
  assert.match(result.error, /没能添加成员/)
  assert.ok(calls.retired.includes('bot-new'))
  assert.ok(calls.retired.includes('ws-verifier-2'))
})
