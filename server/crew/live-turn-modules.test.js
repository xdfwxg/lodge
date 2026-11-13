import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcceptanceRunner } from './live-acceptance.js'
import { createStageIntegrator } from './live-integration.js'
import { createReviewCoordinator } from './live-review.js'
import { createStageStarter } from './live-stage.js'
import { createTurnState } from './live-turn-state.js'
import { deliverableStageIndex, parseVerdict } from './live-turn-utils.js'
import { registerWorkspaceProvider } from './workspace.js'

const makeRoom = overrides => ({
  id: 'room-1',
  name: 'Room',
  goal: 'ship it',
  state: 'active',
  stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  seatNames: { executor: 'Exec', verifier: 'Verifier' },
  seatSpecs: [{ id: 'executor', role: 'worker' }, { id: 'verifier', role: 'verifier' }],
  workers: ['executor'],
  verifiers: [],
  seatBots: { executor: 'bot-exec' },
  usage: {},
  ...overrides,
})

const fakeStore = room => {
  let current = room
  const messages = []
  const events = []
  return {
    readRoom: () => current,
    readRooms: () => [current],
    readMessages: () => messages,
    updateRoom: (_roomId, mutate) => {
      const result = mutate(current)
      return result === null ? null : current
    },
    appendMessage: (_roomId, message) => {
      const stored = { id: `m${messages.length + 1}`, ...message }
      messages.push(stored)
      return stored
    },
    appendEvent: (_roomId, type, payload) => events.push({ type, payload }),
    messages,
    events,
    get current() { return current },
  }
}

test('live turn helpers keep stage and verdict semantics', () => {
  assert.equal(parseVerdict('PASS\nlooks good'), true)
  assert.equal(parseVerdict('**REJECT**\nnot yet'), false)
  assert.equal(parseVerdict('验收通过，盲审结果如下：\n证据一致'), true)
  assert.equal(parseVerdict('不通过：证据不一致'), false)
  assert.equal(parseVerdict('**阶段 2 验收：通过 ✅**\n证据一致'), true)
  assert.equal(parseVerdict('阶段 2 验收：退回\n证据不足'), false)
  assert.equal(parseVerdict('盲审结论：**通过** ✅\n证据一致'), true)
  assert.equal(parseVerdict('盲审结论：无法通过\n证据不足'), false)
  assert.equal(deliverableStageIndex(makeRoom({
    stages: [
      { title: 'align', kind: 'decision', state: 'passed' },
      { title: 'impl', kind: 'deliverable', state: 'active' },
    ],
  })), 1)
})

test('turn state resets progress and updates stage tasks', () => {
  const room = makeRoom({ noProgress: 3 })
  const store = fakeStore(room)
  const state = createTurnState({ store, roomId: 'room-1', emit: () => {} })
  state.markProgress()
  assert.equal(room.noProgress, 0)
  assert.ok(room.lastProgressAt > 0)
  state.updateTasks(0, stage => ({ ...stage, tasks: [{ seat: 'executor', state: 'working' }] }))
  assert.equal(room.stages[0].tasks[0].state, 'working')
})

test('the integrator settles the last worker and turns queue failures into room messages', async () => {
  const room = makeRoom({
    stageDispatch: { stage: 0, workers: ['a', 'b'], pending: ['a', 'b'], failed: [], base: 'base', startedAt: 1 },
  })
  const store = fakeStore(room)
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    updateTasks: () => {},
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 0 }),
  })
  assert.equal(integrator.settle('a', 't1', false), null)
  const done = integrator.settle('b', 't2', false)
  assert.deepEqual(done.workers, ['a', 'b'])
  assert.deepEqual(room.stageDispatch.pending, [])
  await integrator.enqueue(async () => { throw new Error('boom') })
  assert.match(store.messages.at(-1).text, /并行执行出错：boom/)
})

test('a single worker stage sends the prompt and hides the base message', async () => {
  registerWorkspaceProvider('test-live-stage', {
    capabilities: () => ({ candidate: false, isolation: 'worktree' }),
    head: () => '',
  })
  const room = makeRoom({ workspace: { provider: 'test-live-stage' } })
  const store = fakeStore(room)
  const prompts = []
  const starter = createStageStarter({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      prompts.push({ seat, prompt })
      return { messageId: 'm1' }
    },
    updateTasks: () => {},
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0)
  assert.equal(prompts.length, 1)
  assert.match(prompts[0].prompt, /验收命令：`true`/)
  assert.deepEqual(room.hiddenBaseMessages, ['m1'])
})

test('acceptance runs in a disposable copy and records command evidence', async () => {
  registerWorkspaceProvider('test-live-accept', {
    capabilities: () => ({ acceptanceCopy: true, candidate: false }),
    changes: () => ({ diff: 'D', status: 'M', files: ['a.js'], manifest: [] }),
    isolatedCopy: () => ({ path: '/tmp/copy' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    workspace: { provider: 'test-live-accept' },
  })
  const store = fakeStore(room)
  let progressed = 0
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    markProgress: () => { progressed += 1 },
    requestReview: async () => {},
    run: async () => ({ exit: 0, output: 'ok', durationMs: 12, sandbox: { mode: 'off' } }),
  })
  await runner.run(0, 'true', 't1')
  const evidence = store.messages.find(message => message.kind === 'evidence')
  assert.equal(evidence.meta.exit, 0)
  assert.equal(evidence.meta.diff, 'D')
  assert.ok(store.events.some(event => event.type === 'acceptance.run'))
  assert.equal(progressed, 1)
  assert.match(store.messages.at(-1).text, /没有独立验收席位/)
})

test('review request and verdict consumption update the round without crossing turns', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    seatNames: { executor: 'Exec', verifier: 'Verifier' },
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      sent.push({ seat, prompt })
      return { messageId: 'm2' }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(review.isBusy(), true)
  assert.equal(sent[0].seat, 'verifier')
  assert.equal(review.consume({ turn: { reply: 'PASS' }, seat: 'verifier', turnId: 't1', room }), true)
  assert.equal(review.isBusy(), false)
  assert.ok(store.messages.some(message => message.kind === 'verdict' && message.meta.pass === true))
  assert.ok(store.messages.some(message => message.text === '全部验收席位 PASS，等你签字。'))
})

test('Jev advice reaches the Verifier but does not create a verdict', async () => {
  const room = makeRoom({ verifiers: ['verifier'], shadowReview: true })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      sent.push({ seat, prompt })
      return { messageId: 'm2' }
    },
    updateTasks: () => {},
    jev: {
      advice: async () => ({ available: true, advice: [{ summary: '建议补一条回滚测试', score: 0.4 }] }),
    },
  })
  await review.request(0)
  assert.match(sent[0].prompt, /Jev 建议/)
  const advice = store.messages.find(message => message.kind === 'jev_advice')
  assert.ok(advice)
  assert.match(advice.text, /影子评审/)
  assert.equal(advice.meta.shadow, true)
  assert.equal(store.messages.some(message => message.kind === 'verdict'), false)
  assert.equal(review.consume({ turn: { reply: 'PASS' }, seat: 'verifier', turnId: 't1', room }), true)
})

test('manual evidence also goes through the Verifier before human signoff', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    stages: [{ title: 'artifact', kind: 'decision', manual: true, state: 'active' }],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    text: '产物已就绪',
    meta: { stage: 0, kind: 'manual', repoPath: '/tmp/room' },
  })
  const sent = []
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      sent.push({ seat, prompt })
      return { messageId: 'm2' }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(sent[0].seat, 'verifier')
  assert.match(sent[0].prompt, /产物证据/)
  assert.doesNotMatch(sent[0].prompt, /验收命令：/)
  assert.equal(review.consume({ turn: { reply: 'PASS\nok' }, seat: 'verifier', turnId: 't1', room }), true)
  assert.ok(store.messages.some(message => message.kind === 'verdict' && message.meta.pass === true))
})
