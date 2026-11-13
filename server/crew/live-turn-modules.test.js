import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcceptanceRunner } from './live-acceptance.js'
import { createStageIntegrator } from './live-integration.js'
import { createReviewCoordinator } from './live-review.js'
import { createStageStarter } from './live-stage.js'
import { createLiveTurns } from './live-turns.js'
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

test('shadow advice is recorded but never injected into the Verifier prompt', async () => {
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
    advisor: {
      advice: async () => ({ available: true, advice: [{ summary: '建议补一条回滚测试', score: 0.4 }] }),
    },
  })
  await review.request(0)
  assert.doesNotMatch(sent[0].prompt, /评估建议/)
  const advice = store.messages.find(message => message.kind === 'advisor_advice')
  assert.ok(advice)
  assert.match(advice.text, /影子评审/)
  assert.equal(advice.meta.shadow, true)
  assert.equal(store.messages.some(message => message.kind === 'verdict'), false)
  assert.equal(review.consume({ turn: { reply: 'PASS' }, seat: 'verifier', turnId: 't1', room }), true)
})

test('advisor advice is visible to the Verifier when shadow mode is off', async () => {
  const room = makeRoom({ verifiers: ['verifier'], shadowReview: false })
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
    advisor: {
      advice: async () => ({ available: true, advice: [{ summary: '建议补一条回滚测试', score: 0.4 }] }),
    },
  })
  await review.request(0)
  assert.match(sent[0].prompt, /评估建议/)
  const advice = store.messages.find(message => message.kind === 'advisor_advice')
  assert.equal(advice.meta.shadow, false)
  assert.equal(store.messages.some(message => message.kind === 'verdict'), false)
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

test('acceptance skips a later turn that produced no delivery changes', async () => {
  registerWorkspaceProvider('test-live-nochange', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: async () => ({ diff: '', status: '', files: [], manifest: [] }),
    submit: () => { throw new Error('submit must not run without changes') },
    isolatedCopy: () => ({ path: '/tmp/copy' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({ repoPath: '/repo', sourceRepo: '/repo', workspace: { provider: 'test-live-nochange' } })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { kind: 'command', stage: 0, command: 'true', exit: 0 },
  })
  let runs = 0
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    markProgress: () => {},
    requestReview: async () => { throw new Error('review must not run') },
    run: async () => { runs += 1; return { exit: 0 } },
  })
  await runner.run(0, 'true', 't-chatter')
  assert.equal(runs, 0)
  assert.match(store.messages.at(-1).text, /无新增交付改动，沿用已完成的验收/)
  assert.equal(store.messages.filter(message => message.meta?.kind === 'command').length, 1)
})

test('a rework reruns acceptance even when the amended candidate has no working-tree diff', async () => {
  registerWorkspaceProvider('test-live-after-rework', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: async () => ({ diff: '', status: '', files: [], manifest: [] }),
    submit: () => null,
    isolatedCopy: () => ({ path: '/tmp/copy' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({ repoPath: '/repo', sourceRepo: '/repo', workspace: { provider: 'test-live-after-rework' } })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    seq: 1,
    meta: { kind: 'command', stage: 0, command: 'true', exit: 0 },
  })
  store.appendMessage('room-1', { kind: 'rework', seq: 2, text: 'remove local env', meta: { stage: 0 } })
  let runs = 0
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    markProgress: () => {},
    requestReview: async () => { throw new Error('review must not run') },
    run: async () => {
      runs += 1
      return { exit: 0 }
    },
  })
  await runner.run(0, 'true', 't-rework')
  assert.equal(runs, 1)
  const commands = store.messages.filter(message => message.meta?.kind === 'command')
  assert.equal(commands.length, 2)
  assert.equal(commands.at(-1).meta.candidate, null)
  assert.doesNotMatch(store.messages.at(-2).text, /没有可验收的交付改动/)
})

test('a self-committed stage still runs acceptance when HEAD moved past the stage baseline', async () => {
  const copies = []
  registerWorkspaceProvider('test-live-self-commit', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: async () => ({ diff: '', status: '', files: [], manifest: [] }),
    head: () => 'commit-after-baseline',
    rangeChanges: async () => ({ diff: 'diff --git a/src/initials.js', files: ['src/initials.js'] }),
    submit: () => null,
    isolatedCopy: input => {
      copies.push(input)
      return { path: '/tmp/copy' }
    },
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    stageBases: { 0: 'stage-baseline' },
    workspace: { provider: 'test-live-self-commit' },
  })
  const store = fakeStore(room)
  let runs = 0
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    markProgress: () => {},
    requestReview: async () => { throw new Error('review must not run') },
    run: async () => {
      runs += 1
      return { exit: 0 }
    },
  })
  await runner.run(0, 'true', 't-self-commit')
  assert.equal(runs, 1)
  assert.equal(copies[0].ref, 'commit-after-baseline')
  const evidence = store.messages.find(message => message.meta?.kind === 'command')
  assert.equal(evidence.meta.head, 'commit-after-baseline')
  assert.deepEqual(evidence.meta.files, ['src/initials.js'])
  assert.match(evidence.meta.diff, /src\/initials\.js/)
})

test('acceptance records the candidate commit, not the pre-submit HEAD, as covered', async () => {
  const copies = []
  registerWorkspaceProvider('test-live-candidate-head', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: async () => ({ diff: 'diff', status: ' M src/a.js', files: ['src/a.js'], manifest: [] }),
    head: () => 'base-head',
    submit: () => 'candidate-1',
    isolatedCopy: input => {
      copies.push(input)
      return { path: '/tmp/copy' }
    },
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    stageBases: { 0: 'base-head' },
    workspace: { provider: 'test-live-candidate-head' },
  })
  const store = fakeStore(room)
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    markProgress: () => {},
    requestReview: async () => { throw new Error('review must not run') },
    run: async () => ({ exit: 0 }),
  })
  await runner.run(0, 'true', 't-candidate')
  const evidence = store.messages.find(message => message.meta?.kind === 'command')
  assert.equal(evidence.meta.candidate, 'candidate-1')
  assert.equal(evidence.meta.head, 'candidate-1')
  assert.equal(copies[0].ref, 'candidate-1')
})

test('a worker chatter turn does not start another acceptance round', async () => {
  const room = makeRoom({
    workers: ['worker'],
    seatBots: { worker: 'bot-worker' },
    seatNames: { worker: 'Worker' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: 'Worker' }],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  })
  const store = fakeStore(room)
  let runs = 0
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
    commands: { run: async () => { runs += 1; return { exit: 0 } } },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ turnId: 't-chatter', reply: '收到，没有待办。', toolCalls: 0, tools: [] }, 'bot-worker')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(runs, 0)
  assert.equal(store.messages.some(message => message.meta?.kind === 'command'), false)
})

test('new evidence restarts an in-flight review and ignores the stale verdict', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: 'old' },
  })
  const sent = []
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      sent.push({ seat, prompt })
      return { messageId: `m${sent.length}` }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: 'new' },
  })
  await review.request(0)
  assert.equal(sent.length, 2)
  assert.equal(review.isBusy(), true)
  assert.equal(review.consume({ turn: { reply: 'REJECT old' }, seat: 'verifier', turnId: 't-old', room }), false)
  assert.equal(review.consume({ turn: { reply: 'PASS new' }, seat: 'verifier', turnId: 't-new', room }), true)
  assert.equal(store.messages.some(message => message.kind === 'verdict' && message.meta.pass === true), true)
})

test('a verifier reject returns the studio closure to executing', async () => {
  const room = makeRoom({ verifiers: ['verifier'], closure: 'verifying' })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: '' },
  })
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: 'm2' }),
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(review.consume({ turn: { reply: 'REJECT\n证据不足' }, seat: 'verifier', turnId: 't1', room }), true)
  assert.equal(room.closure, 'executing')
})
