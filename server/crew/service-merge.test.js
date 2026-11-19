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

test('a finished studio room can be given a daily rhythm', async () => {
  const ctx = setup(room({ state: 'complete', mergeConflict: null }), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'routine', {
    method: 'POST',
    readBody: async () => ({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 }),
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(ctx.room().routine.enabled, true)
  assert.deepEqual(ctx.room().routine.days, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(ctx.room().routine.hour, 8)
  assert.match(ctx.messages.at(-1).text, /每天 8:00/)
  assert.match(ctx.messages.at(-1).text, /Lodge 关着时不会跑/)
})

test('turning a rhythm off leaves no timer behind', async () => {
  const ctx = setup(room({ state: 'complete', mergeConflict: null, routine: { days: [1, 3, 5], hour: 8, enabled: true } }), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'routine', {
    method: 'POST',
    readBody: async () => ({ enabled: false }),
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(ctx.room().routine.enabled, false)
  assert.deepEqual(ctx.room().routine.days, [1, 3, 5])
  assert.equal(ctx.room().routine.nextRunAt, null)
  assert.match(ctx.messages.at(-1).text, /不再自动做/)
})

test('an unfinished room cannot become a routine', async () => {
  const ctx = setup(room(), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'routine', {
    method: 'POST',
    readBody: async () => ({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 8 }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /做完后/)
})

test('a chat room never becomes a routine', async () => {
  const ctx = setup(room({ roomType: 'chat', state: 'complete', mergeConflict: null }), { status: '', diff: '' })
  const result = await ctx.service.roomRequest('room-merge', 'routine', {
    method: 'POST',
    readBody: async () => ({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 8 }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /工作室/)
})
