import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { normalizeTestRoom, withAssignments } from './testing/room.js'

const room = (over = {}) => normalizeTestRoom({
  id: 'room-1',
  kind: 'room',
  state: 'active',
  live: true,
  demo: false,
  busy: false,
  openQuestion: null,
  verifiers: [],
  workers: ['worker'],
  seatNames: { worker: '执行者' },
  usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
  stages: [
    { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test', tasks: [] },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  seatSpecs: [{ id: 'worker', name: '执行者', role: 'worker' }],
  seatBots: { worker: 'bot-worker' },
  ...over,
})

const setup = initial => {
  let current = initial
  const messages = []
  const store = withAssignments({
    readRooms: () => [current],
    readMessages: () => messages,
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
  })
  const calls = []
  const stages = createServiceStages({
    store,
    live: {
      reworkStage: async (target, index, note) => { calls.push({ target, index, note }) },
      isAttached: () => true,
      resume: async (id, options) => { calls.push({ resume: id, options }) },
      startStage: async (value, index) => { calls.push({ startStage: index }) },
    },
    emit: () => {},
    completeRoom: value => value,
    roomFiles: { writeGoal: () => {} },
  })
  return { store, stages, room: () => current, messages, calls }
}

test('changing the acceptance command reruns it, but an unchanged save does not', () => {
  const ctx = setup(room())
  const changed = ctx.stages.setAcceptance(ctx.room(), 0, 'npm run check')
  assert.equal(changed.ok, true)
  const resumes = ctx.calls.filter(call => call.resume !== undefined)
  assert.equal(resumes.length, 1)
  assert.equal(resumes[0].options.forceAcceptance, true)
  const unchanged = ctx.stages.setAcceptance(ctx.room(), 0, 'npm run check')
  assert.equal(unchanged.ok, true)
  assert.equal(ctx.calls.filter(call => call.resume !== undefined).length, 1)
})

test('rework records the human objection and re-dispatches the active stage', async () => {
  const ctx = setup(room())
  ctx.store.writeAssignment({
    id: 'as-work', roomId: 'room-1', stageIndex: 0, toMemberId: 'worker', reason: 'dispatch',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  const result = await ctx.stages.rework(ctx.room(), { stage: 0, note: '方向不对' })
  assert.equal(result.ok, true)
  const rework = [...ctx.messages].reverse().find(message => message.kind === 'rework')
  assert.equal(rework.text, '方向不对')
  const context = [...ctx.messages].reverse().find(message => message.kind === 'human-context')
  assert.equal(context.text, '方向不对')
  assert.equal(context.meta.source, 'rework')
  assert.equal(context.meta.stage, 0)
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].index, 0)
  assert.equal(ctx.calls[0].note, '方向不对')
  assert.equal(ctx.store.readAssignment('as-work').status, 'failed')
  assert.equal(ctx.room().lastPlannerDecision ?? null, null)
})

test('a planner tool can rewind while its own turn is busy', () => {
  const ctx = setup(room({ busyMembers: ['planner'] }))
  const blocked = ctx.stages.rewind(ctx.room(), { stage: 0, note: '补一句：先看 README' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'conflict')
  const allowed = ctx.stages.rewind(ctx.room(), { stage: 0, note: '补一句：先看 README' }, { allowBusy: true })
  assert.equal(allowed.ok, true)
  assert.equal(ctx.room().stages[0].state, 'active')
})

test('rewinding to an earlier step reopens it and resets everything after it', async () => {
  const ctx = setup(room({
    stageBases: { 0: 'base-0', 1: 'base-1', 2: 'base-2' },
    stages: [
      { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
      { title: '补一条', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }))
  ctx.store.writeAssignment({
    id: 'as-old', roomId: 'room-1', stageIndex: 0, toMemberId: 'worker', reason: 'dispatch',
    brief: {}, status: 'sent', context: {}, flags: {},
  })
  ctx.store.writeAssignment({
    id: 'as-next', roomId: 'room-1', stageIndex: 1, toMemberId: 'worker', reason: 'dispatch',
    brief: {}, status: 'sent', context: {}, flags: {},
  })
  const result = await ctx.stages.rewind(ctx.room(), { stage: 0, note: '目标理解错了，回到第一步' })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.room().stages.map(stage => stage.state), ['active', 'pending', 'pending'])
  assert.deepEqual(ctx.room().stageBases, { 0: 'base-0' })
  assert.equal(ctx.store.readAssignment('as-old').status, 'failed')
  assert.equal(ctx.store.readAssignment('as-next').status, 'cancelled')
  const markers = ctx.messages.filter(message => message.kind === 'rework')
  assert.deepEqual(markers.map(message => message.meta.stage), [0, 1, 2])
  assert.equal(markers[0].text, '目标理解错了，回到第一步')
  assert.equal(markers[0].meta.source, 'rewind')
  assert.equal(markers[1].meta.source, 'rewind')
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].index, 0)
  assert.equal(ctx.calls[0].note, '目标理解错了，回到第一步')
})

test('adding context to the current step reruns it in place', async () => {
  const ctx = setup(room())
  const result = await ctx.stages.rewind(ctx.room(), { stage: 0, note: '补一句：先看 README' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().stages[0].state, 'active')
  assert.equal(ctx.calls[0].index, 0)
  assert.equal(ctx.calls[0].note, '补一句：先看 README')
  const markers = ctx.messages.filter(message => message.kind === 'rework')
  assert.equal(markers[0].text, '补一句：先看 README')
  assert.equal(markers[0].meta.source, 'rewind')
})

test('rewind needs a note, refuses pending steps, and can reopen a decision node', () => {
  const ctx = setup(room())
  assert.equal(ctx.stages.rewind(ctx.room(), { stage: 0, note: '' }).ok, false)
  const pending = room({
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
      { title: '补一条', kind: 'deliverable', state: 'pending', acceptance: 'npm test' },
    ],
  })
  assert.match(ctx.stages.rewind(pending, { stage: 1, note: 'x' }).error, /还没开始/)
  const decision = room({ stages: [{ title: '定方向', kind: 'decision', state: 'passed' }] })
  const reopened = ctx.stages.rewind(decision, { stage: 0, note: '重新对一下方向' })
  assert.equal(reopened.ok, true)
  assert.equal(reopened.body.room.stages[0].state, 'active')
})

test('rewinding a delivered room reopens it without losing the first step base', async () => {
  const ctx = setup(room({
    stageBases: { 0: 'base-0', 1: 'base-1' },
    stages: [
      { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
      { title: '验收与结论', kind: 'decision', state: 'passed' },
    ],
  }))
  const result = await ctx.stages.rewind(ctx.room(), { stage: 0, note: '再补一处' })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.room().stages.map(stage => stage.state), ['active', 'pending'])
  assert.deepEqual(ctx.room().stageBases, { 0: 'base-0' })
  assert.equal(ctx.room().state, 'active')
})

test('accepting the last work stage also confirms the system conclusion', () => {
  const ctx = setup(room({ live: false, roomType: 'studio', verificationMode: 'hybrid', verifiers: ['verifier'] }))
  ctx.messages.push({ id: 'e-1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0 } })
  ctx.messages.push({ id: 'v-1', seq: 2, kind: 'verdict', authorId: 'verifier', meta: { stage: 0, pass: true, evidenceId: 'e-1' } })
  ctx.store.writeAssignment({
    id: 'as-work', roomId: 'room-1', stageIndex: 0, toMemberId: 'worker', reason: 'dispatch',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, true)
  assert.equal(ctx.store.readAssignment('as-work').status, 'passed')
  assert.equal(ctx.messages.some(message => message.kind === 'stage_conclusion'), false)
  assert.equal(ctx.room().stages[1].state, 'passed')
  // 纯聊天：最后一步通过后房间保持打开，不再收尾。
  assert.equal(ctx.room().state, 'active')
  // 阶段状态已经说明结果；系统不再写一条同义的 gate 小字。
  assert.equal(ctx.messages.some(message => message.meta?.kind === 'gate'), false)
})





test('a person can confirm a plain decision stage without a verdict', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    verificationMode: 'manual',
    verifiers: ['verifier'],
    stages: [
      { title: '定方向', kind: 'decision', state: 'active' },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }))
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, true, result.error)
  assert.equal(ctx.room().stages[0].state, 'passed')
})

test('a studio cannot sign without a Verifier PASS', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    verificationMode: 'hybrid',
    verifiers: ['verifier'],
    stages: [{ title: '验收与结论', kind: 'decision', state: 'active' }],
  }))
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, false)
  assert.match(result.error, /验收员/)
  assert.equal(ctx.room().stages[0].state, 'active')
})

test('a force flag cannot sign without a Verifier PASS', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    verificationMode: 'hybrid',
    verifiers: ['verifier'],
    stages: [{ title: '验收与结论', kind: 'decision', state: 'active' }],
  }))
  const result = ctx.stages.accept(ctx.room(), { stage: 0, force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /验收员/)
  assert.equal(ctx.room().stages[0].state, 'active')
})

test('accepting a work stage writes a stage conclusion before the next stage starts', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    verificationMode: 'hybrid',
    verifiers: ['verifier'],
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test', tasks: [] },
      { title: '回归', kind: 'deliverable', state: 'pending', acceptance: 'npm run e2e', tasks: [] },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }))
  ctx.messages.push({ id: 'e-1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0, files: ['src/a.js', 'src/a.test.js'] } })
  ctx.messages.push({ id: 'v-1', seq: 2, kind: 'verdict', authorId: 'verifier', meta: { stage: 0, pass: true, evidenceId: 'e-1' } })
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, true)
  const conclusion = ctx.messages.find(message => message.kind === 'stage_conclusion')
  assert.ok(conclusion)
  assert.equal(conclusion.meta.stage, 0)
  assert.equal(conclusion.meta.next, '回归')
  assert.equal(conclusion.meta.command, 'npm test')
  assert.deepEqual(conclusion.meta.verdicts, [{ name: 'verifier', pass: true }])
  assert.equal(ctx.room().stages[1].state, 'active')
})

test('accepting an intermediate stage starts the next one by itself', async () => {
  const ctx = setup(room({
    roomType: 'studio',
    verificationMode: 'hybrid',
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test', tasks: [] },
      { title: '回归', kind: 'deliverable', state: 'pending', acceptance: 'npm run e2e', tasks: [] },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }))
  ctx.messages.push({ id: 'e-1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0, files: ['src/a.js', 'src/a.test.js'] } })
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, true)
  await Promise.resolve()
  assert.deepEqual(ctx.calls.filter(call => call.startStage !== undefined), [{ startStage: 1 }])
})
