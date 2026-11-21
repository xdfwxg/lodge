import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewService } from './service.js'

const room = (over = {}) => ({
  id: 'room-merge',
  kind: 'room',
  roomType: 'studio',
  verify: 'test',
  state: 'active',
  live: true,
  goal: '两位执行官同时改 shared.txt',
  mergeConflict: {
    stage: 1,
    files: ['shared.txt'],
    path: '/tmp/room/integration',
    worker: 'worker',
    branch: 'crew/merge/worker',
  },
  stages: [
    { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'test -f shared.txt' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  ...over,
})

const setup = (initial, changes) => {
  let current = structuredClone(initial)
  const messages = []
  const resolved = []
  const store = {
    readRoom: id => (id === current.id ? current : null),
    readRooms: () => [current],
    readMessages: () => messages,
    readMessagesSince: () => messages,
    readAssignments: () => [],
    writeRoom: () => current,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    updateRound: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m-${messages.length + 1}`, seq: messages.length + 1, ...message }
      messages.push(stored)
      return stored
    },
    appendEvent: () => {},
    deleteRoom: () => false,
  }
  const ports = {
    roomFiles: { writeGoal: () => {}, writeConclusion: () => {}, writeDiagnostic: () => {}, roomDir: () => '', roomRootOf: () => '/tmp/room' },
    memory: { appendRoom: () => ({ ok: false, reason: 'no-workspace' }) },
    workspace: {
      provider: () => ({ changes: async () => changes }),
      byId: () => undefined,
      default: { probeSource: () => ({ ok: false }), scratchRoot: () => '' },
      root: '',
      writeMemberEnv: () => {},
      exists: () => false,
      remove: () => {},
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => '', list: () => [], isDirectory: () => false, mtimeMs: () => 0, remove: () => {} },
  }
  const service = createCrewService({
    store,
    engine: { health: async () => ({}), instances: async () => [] },
    live: {
      setConfirmStage: () => {},
      isAttached: () => true,
      resolveMerged: async (roomId, stage) => { resolved.push({ roomId, stage }) },
    },
    emit: () => {},
    roles: [],
    ports,
  })
  return { service, room: () => current, messages, resolved }
}

test('a human-resolved conflict continues acceptance from the current head', async () => {
  const ctx = setup(room(), { status: '', diff: '- alpha\n+ alpha\n+ beta' })
  const result = await ctx.service.roomRequest('room-merge', 'resolve-merge', { method: 'POST' })
  assert.equal(result.ok, true, result.error)
  assert.equal(ctx.room().mergeConflict, null)
  assert.equal(ctx.room().mergeResolved.stage, 1)
  assert.deepEqual(ctx.resolved, [{ roomId: 'room-merge', stage: 1 }])
  const human = ctx.messages.find(message => message.authorId === 'you' && message.meta?.source === 'merge')
  assert.match(human.text, /保留两条内容并提交/)
})

test('an unresolved file keeps the conflict and does not ask for review', async () => {
  const ctx = setup(room(), { status: 'UU shared.txt', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'resolve-merge', { method: 'POST' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '还有没解决的冲突文件')
  assert.equal(ctx.room().mergeConflict.stage, 1)
  assert.deepEqual(ctx.resolved, [])
})

test('a resolution that was not committed is refused', async () => {
  const ctx = setup(room(), { status: ' M shared.txt', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'resolve-merge', { method: 'POST' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '解决结果还没有提交；先提交再继续')
  assert.equal(ctx.room().mergeConflict.stage, 1)
})

test('conflict markers left in the file are refused', async () => {
  const ctx = setup(room(), { status: '', diff: '<<<<<<< HEAD\nalpha\n=======\nbeta\n>>>>>>> worker' })
  const result = await ctx.service.roomRequest('room-merge', 'resolve-merge', { method: 'POST' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '文件里还留着冲突标记')
  assert.equal(ctx.room().mergeConflict.stage, 1)
})

test('a room without a conflict cannot be told to continue', async () => {
  const ctx = setup(room({ mergeConflict: null }), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'resolve-merge', { method: 'POST' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '这一步没有合并冲突')
  assert.deepEqual(ctx.resolved, [])
})

test('accepting a stage that already passed is not an error', async () => {
  const ctx = setup(room({
    mergeConflict: null,
    stages: [
      { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'test -f shared.txt' },
      { title: '验收与结论', kind: 'decision', state: 'active' },
    ],
  }), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'accept', {
    method: 'POST',
    readBody: async () => ({ stage: 0 }),
  })
  assert.equal(result.ok, true, result.error)
})

test('accepting a stage that is not waiting says so in plain words', async () => {
  const ctx = setup(room({ mergeConflict: null }), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'accept', {
    method: 'POST',
    readBody: async () => ({ stage: 1 }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /不在等你确认/)
})

