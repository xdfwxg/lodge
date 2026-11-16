import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcceptanceRunner } from './rooms/studio/acceptance-runner.js'
import { createStageIntegrator } from './rooms/studio/integration.js'
import { createReviewCoordinator } from './rooms/studio/review.js'
import { createStageStarter } from './rooms/studio/stage.js'
import { createLiveTurns } from './rooms/studio/turns.js'
import { createTurnState } from './rooms/studio/turn-state.js'
import { deliverableStageIndex, parsePlannerDecision, parseVerdict } from './rooms/studio/turn-utils.js'
import { registerWorkspaceProvider } from './workspace.js'

const makeRoom = overrides => ({
  id: 'room-1',
  name: 'Room',
  goal: 'ship it',
  state: 'active',
  stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  seatNames: { executor: 'Exec', verifier: 'Verifier' },
  seatSpecs: [
    { id: 'executor', name: '执行官', role: 'worker' },
    { id: 'verifier', name: '验收员', role: 'verifier' },
  ],
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
  assert.deepEqual(parsePlannerDecision('返工\n改成写入欢迎语'), { kind: 'rework', note: '改成写入欢迎语' })
  assert.deepEqual(parsePlannerDecision('REWORK\nredo it'), { kind: 'rework', note: 'redo it' })
  assert.equal(parsePlannerDecision('交给人\n需要你决定权限').kind, 'human')
})

test('a rejected stage routes the planner decision to the executor or the human', () => {
  const room = makeRoom({
    leadSeat: 'planner',
    members: ['planner', 'executor', 'verifier'],
    seatNames: { planner: 'Planner', executor: 'Exec', verifier: 'Verifier' },
    seatSpecs: [
      { id: 'planner', name: '规划师', role: 'lead' },
      { id: 'executor', name: '执行官', role: 'worker' },
      { id: 'verifier', name: '验收员', role: 'verifier' },
    ],
    seatBots: { planner: 'bot-plan', executor: 'bot-exec', verifier: 'bot-ver' },
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: { pass: false, stage: 0 },
  })
  const sent = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      sent.push({ seat, prompt })
      return { messageId: `m${sent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ reply: '返工\n改成写入欢迎语', turnId: 't-lead-1', toolCalls: 0 }, 'bot-plan')
  const worker = sent.find(item => item.seat === 'executor')
  assert.ok(worker)
  assert.match(worker.prompt, /规划师的返工要求：改成写入欢迎语/)
  assert.match(worker.prompt, /lodge-internal/)
  assert.equal(room.lastPlannerDecision.kind, 'rework')

  const humanRoom = makeRoom({
    leadSeat: 'planner',
    seatNames: { planner: 'Planner', executor: 'Exec', verifier: 'Verifier' },
    seatSpecs: [
      { id: 'planner', name: '规划师', role: 'lead' },
      { id: 'executor', name: '执行官', role: 'worker' },
      { id: 'verifier', name: '验收员', role: 'verifier' },
    ],
    seatBots: { planner: 'bot-plan', executor: 'bot-exec' },
  })
  const humanStore = fakeStore(humanRoom)
  humanStore.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: { pass: false, stage: 0 },
  })
  const humanSent = []
  const humanTurns = createLiveTurns({
    store: humanStore,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      humanSent.push({ seat, prompt })
      return { messageId: `m${humanSent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  humanTurns.captureTurn({ reply: '交给人\n需要你决定权限', turnId: 't-lead-2', toolCalls: 0 }, 'bot-plan')
  assert.equal(humanSent.length, 0)
  assert.equal(humanRoom.lastPlannerDecision.kind, 'human')
  assert.equal(humanStore.messages.some(message => message.kind === 'system' && /规划师把/.test(message.text)), false)
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
  assert.equal(prompts[0].seat, room.workers[0])
  assert.match(prompts[0].prompt, /验收命令：`true`/)
  assert.match(prompts[0].prompt, /@执行官/)
})

test('parallel dispatch wakes every assignee and tracks pending seats', async () => {
  registerWorkspaceProvider('test-live-parallel', {
    capabilities: () => ({ candidate: false, merge: true, isolation: 'worktree' }),
    head: () => 'base',
  })
  const room = makeRoom({
    workspace: { provider: 'test-live-parallel' },
    repoPath: '/repo',
    orchestration: 'parallel',
    workers: ['executor', 'executor-2'],
    seatNames: { executor: 'Exec', 'executor-2': 'Exec2' },
    seatSpecs: [
      { id: 'executor', name: '执行官', role: 'worker' },
      { id: 'executor-2', name: '执行官 2', role: 'worker' },
    ],
  })
  const store = fakeStore(room)
  const prompts = []
  const starter = createStageStarter({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async (seat, prompt) => {
      prompts.push({ seat, prompt })
      return { messageId: `m-${seat}` }
    },
    updateTasks: () => {},
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0)
  assert.deepEqual(prompts.map(item => item.seat), ['executor', 'executor-2'])
  assert.match(prompts[0].prompt, /自己的 worktree/)
  assert.match(prompts[0].prompt, /@执行官/)
  assert.match(prompts[1].prompt, /@执行官 2/)
  assert.deepEqual(room.stageDispatch.workers, ['executor', 'executor-2'])
  assert.deepEqual(room.stageDispatch.pending, ['executor', 'executor-2'])
  assert.equal(room.stageDispatch.base, 'base')
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
  assert.match(store.messages.at(-1).text, /没有验收员/)
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
  assert.ok(store.messages.some(message => message.text === '全部验收员通过，可以签字了。'))
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
  assert.match(sent[0].prompt, /结果证据/)
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
  assert.match(store.messages.at(-1).text, /这次没有新的改动，沿用上次的检查结果/)
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

test('a repeated manual turn on the same HEAD does not duplicate manual evidence', async () => {
  registerWorkspaceProvider('test-manual-dedupe', {
    capabilities: () => ({ candidate: true }),
    head: () => 'manual-head-1',
    changedFilesSince: () => ['NOTES.md'],
    submit: () => null,
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    stageBases: { 0: 'manual-base' },
    workspace: { provider: 'test-manual-dedupe' },
    stages: [{ title: 'artifact', kind: 'decision', manual: true, state: 'active' }],
    verifiers: [],
  })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: async () => ({ messageId: null }),
    commands: { run: async () => ({ exit: 0 }) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ turnId: 't-manual-1', reply: '产物已就绪', toolCalls: 2, tools: [] }, 'bot-exec')
  turns.captureTurn({ turnId: 't-manual-2', reply: '再次确认', toolCalls: 2, tools: [] }, 'bot-exec')
  assert.equal(store.messages.filter(message => message.meta?.kind === 'manual').length, 1)
  const evidence = store.messages.find(message => message.meta?.kind === 'manual')
  assert.equal(evidence.meta.head, 'manual-head-1')
  assert.deepEqual(evidence.meta.changedFiles, ['NOTES.md'])
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

test('a verifier reject returns the studio closure to executing and wakes the planner', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    closure: 'verifying',
    leadSeat: 'planner',
    members: ['planner', 'executor', 'verifier'],
    seatNames: { planner: 'Planner', executor: 'Exec', verifier: 'Verifier' },
    seatSpecs: [
      { id: 'planner', role: 'lead' },
      { id: 'executor', role: 'worker' },
      { id: 'verifier', role: 'verifier' },
    ],
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
      return { messageId: `m${sent.length}` }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(review.consume({ turn: { reply: 'REJECT\n证据不足' }, seat: 'verifier', turnId: 't1', room }), true)
  assert.equal(room.closure, 'executing')
  const planner = sent.find(item => item.seat === 'planner')
  assert.ok(planner)
  assert.match(planner.prompt, /验收员退回了第 1 步/)
  assert.match(planner.prompt, /证据不足/)
  assert.match(planner.prompt, /第一行只写「返工」或「交给人」/)
  assert.match(planner.prompt, /不要在回复里 @ 任何人/)
  assert.match(planner.prompt, /lodge-internal/)
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
  assert.match(advice.text, /第二意见/)
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
  assert.match(sent[0].prompt, /回滚测试/)
  const advice = store.messages.find(message => message.kind === 'advisor_advice')
  assert.equal(advice.meta.shadow, false)
})
