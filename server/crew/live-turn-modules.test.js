import assert from 'node:assert/strict'
import test from 'node:test'
import { createAcceptanceRunner } from './rooms/studio/acceptance-runner.js'
import { createHandoff } from './rooms/studio/handoff.js'
import { createStageIntegrator } from './rooms/studio/integration.js'
import { createReviewCoordinator } from './rooms/studio/review.js'
import { createStageStarter } from './rooms/studio/stage.js'
import { createLiveTurns } from './rooms/studio/turns.js'
import { createTurnState } from './rooms/studio/turn-state.js'
import { deliverableStageIndex, parsePlannerDecision, parseVerdict } from './rooms/studio/turn-utils.js'
import { registerWorkspaceProvider } from './workspace.js'
import { normalizeLegacyTestRoom, withAssignments } from './testing/room.js'

const makeRoom = overrides => normalizeLegacyTestRoom({
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
  return withAssignments({
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
  })
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
  store.writeAssignment({
    id: 'as-old', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: { pass: false, stage: 0 },
  })
  const sent = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ reply: '返工\n改成写入欢迎语', turnId: 't-lead-1', toolCalls: 0 }, 'bot-plan')
  const worker = sent.find(item => item.memberId === 'executor')
  assert.ok(worker)
  assert.match(worker.prompt, /改成写入欢迎语/)
  assert.match(worker.prompt, /lodge-internal/)
  assert.equal(room.lastPlannerDecision.kind, 'rework')
  assert.equal(room.lastPlannerDecision.judgment.decision, 'rework')
  assert.ok(store.messages.some(message => (
    message.kind === 'rework' &&
    message.meta?.stage === 0 &&
    message.meta?.source === 'planner'
  )))
  const reworkAssignment = store.readAssignments('room-1').find(item => item.reason === 'rework')
  assert.equal(reworkAssignment.parentAssignmentId, 'as-old')
  assert.equal(store.readAssignment('as-old').status, 'failed')

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
  humanStore.writeAssignment({
    id: 'as-human', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  humanStore.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: { pass: false, stage: 0 },
  })
  const humanSent = []
  const humanTurns = createLiveTurns({
    store: humanStore,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      humanSent.push({ memberId, prompt })
      return { messageId: `m${humanSent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  humanTurns.captureTurn({ reply: '交给人\n需要你决定权限', turnId: 't-lead-2', toolCalls: 0 }, 'bot-plan')
  assert.equal(humanSent.length, 0)
  assert.equal(humanRoom.lastPlannerDecision.kind, 'human')
  assert.equal(humanStore.readAssignment('as-human').status, 'rejected')
  assert.equal(humanStore.messages.some(message => message.kind === 'system' && /规划师把/.test(message.text)), false)
})

test('a merge conflict is left for the human instead of being auto-reworked', () => {
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
  room.mergeConflict = { stage: 0, files: ['shared.txt'] }
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: { pass: false, stage: 0 },
  })
  const sent = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ reply: '返工\n把 shared.txt 改成 alpha', turnId: 't-lead-3', toolCalls: 0 }, 'bot-plan')
  assert.equal(sent.length, 0)
  assert.equal(room.mergeConflict.stage, 0)
  assert.equal(room.lastPlannerDecision.kind, 'rework')
})

test('a parallel rework decided by the planner goes into the member private worktree', () => {
  const room = makeRoom({
    leadSeat: 'planner',
    members: ['planner', 'executor', 'executor-2', 'verifier'],
    seatNames: { planner: 'Planner', executor: 'Exec', 'executor-2': 'Exec2', verifier: 'Verifier' },
    seatSpecs: [
      { id: 'planner', name: '规划师', role: 'lead' },
      { id: 'executor', name: '执行官', role: 'worker' },
      { id: 'executor-2', name: '执行官二号', role: 'worker' },
      { id: 'verifier', name: '验收员', role: 'verifier' },
    ],
    seatBots: { planner: 'bot-plan', executor: 'bot-exec', 'executor-2': 'bot-exec2', verifier: 'bot-ver' },
    workers: ['executor', 'executor-2'],
  })
  const store = fakeStore(room)
  for (const id of ['executor', 'executor-2']) {
    store.writeAssignment({
      id: `as-${id}`, roomId: 'room-1', stageIndex: 0, toMemberId: id, reason: 'dispatch',
      brief: {}, status: 'reported', context: { parallel: true }, flags: {},
    })
  }
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: { pass: false, stage: 0 },
  })
  const sent = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt, options = {}) => {
      sent.push({ memberId, prompt, options })
      return { messageId: `m${sent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ reply: '返工\n两人各写自己的文件', turnId: 't-lead-parallel', toolCalls: 0 }, 'bot-plan')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].options.privateRoom, true)
})

test('turn state resets progress', () => {
  const room = makeRoom({ noProgress: 3 })
  const store = fakeStore(room)
  const state = createTurnState({ store, roomId: 'room-1', emit: () => {} })
  state.markProgress()
  assert.equal(room.noProgress, 0)
  assert.ok(room.lastProgressAt > 0)
})

test('the integrator settles the last worker and turns queue failures into room messages', async () => {
  const room = makeRoom()
  const store = fakeStore(room)
  for (const worker of ['a', 'b']) {
    store.writeAssignment({
      id: `as-${worker}`,
      roomId: 'room-1',
      stageIndex: 0,
      fromMemberId: 'planner',
      toMemberId: worker,
      reason: 'dispatch',
      brief: {},
      status: 'reported',
      context: { base: 'base' },
      flags: {},
      createdAt: 1,
      updatedAt: 1,
    })
  }
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 0 }),
  })
  store.updateAssignment('as-b', assignment => { assignment.status = 'sent'; return true })
  assert.equal(integrator.settle('a', 't1', false), null)
  store.updateAssignment('as-b', assignment => { assignment.status = 'reported'; return true })
  const done = integrator.settle('b', 't2', false)
  assert.deepEqual(done.workers, ['a', 'b'])
  assert.equal(done.base, 'base')
  await integrator.enqueue(async () => { throw new Error('boom') })
  assert.match(store.messages.at(-1).text, /合改动时出了点问题/)
  assert.equal(store.messages.at(-1).meta?.detail, 'boom')
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
    sendToMember: async (memberId, prompt) => {
      prompts.push({ memberId, prompt })
      return { messageId: 'm1' }
    },
    updateTasks: () => {},
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].memberId, room.workers[0])
  assert.match(prompts[0].prompt, /验收命令：`true`/)
  assert.match(prompts[0].prompt, /阶段 1/)
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
  const sendToMember = async (memberId, prompt) => {
    prompts.push({ memberId, prompt })
    return { messageId: `m-${memberId}` }
  }
  const handoff = createHandoff({ store, roomId: 'room-1', sendToMember, emit: () => {} })
  const starter = createStageStarter({
    store,
    roomId: 'room-1',
    emit: () => {},
    handoff,
    sendToMember,
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0)
  assert.deepEqual(prompts.map(item => item.memberId), ['executor', 'executor-2'])
  assert.match(prompts[0].prompt, /自己的 worktree/)
  assert.match(prompts[0].prompt, /自己的 worktree/)
  assert.match(prompts[1].prompt, /自己的 worktree/)
  const assignments = store.readAssignments('room-1')
  assert.deepEqual(assignments.map(assignment => assignment.toMemberId), ['executor', 'executor-2'])
  assert.deepEqual(assignments.filter(assignment => assignment.status === 'sent').map(assignment => assignment.toMemberId), ['executor', 'executor-2'])
  assert.equal(assignments[0].context.base, 'base')
  assert.equal(room.stageDispatch, undefined)
})

test('a parallel stage delivers into each worktree even when the planner speaks', async () => {
  registerWorkspaceProvider('test-live-parallel-spoken', {
    capabilities: () => ({ candidate: false, merge: true, isolation: 'worktree' }),
    head: () => 'base',
  })
  const room = makeRoom({
    workspace: { provider: 'test-live-parallel-spoken' },
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
  const sendToMember = async (memberId, prompt, options = {}) => {
    prompts.push({ memberId, prompt, options })
    return { messageId: `m-${memberId}` }
  }
  const plannerPrompts = []
  const handoff = createHandoff({ store, roomId: 'room-1', sendToMember, emit: () => {} })
  const starter = createStageStarter({
    store,
    roomId: 'room-1',
    emit: () => {},
    handoff,
    sendToMember,
    askPlanner: async prompt => {
      plannerPrompts.push(prompt)
      return '执行官写一个文件，执行官 2 写另一个文件。'
    },
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0)
  assert.match(plannerPrompts[0], /不要 @ 任何人/)
  assert.deepEqual(prompts.map(item => item.memberId), ['executor', 'executor-2'])
  assert.match(prompts[0].prompt, /自己的 worktree/)
  assert.match(prompts[1].prompt, /自己的 worktree/)
  assert.equal(prompts[0].options.privateRoom, true)
  assert.equal(prompts[1].options.privateRoom, true)
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
    seatSpecs: [{ id: 'executor', name: '执行官', role: 'worker' }],
    verifiers: [],
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
  assert.match(store.messages.at(-1).text, /这一步做完了/)
})

test('a failed acceptance surfaces a blocked room instead of going quiet', async () => {
  registerWorkspaceProvider('test-live-failcheck', {
    capabilities: () => ({ acceptanceCopy: true, candidate: false }),
    changes: () => ({ diff: 'D', status: 'M', files: ['a.js'], manifest: [] }),
    isolatedCopy: () => ({ path: '/tmp/copy' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    workspace: { provider: 'test-live-failcheck' },
    verifiers: [],
  })
  const store = fakeStore(room)
  const emitted = []
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    emit: (_event, updated) => emitted.push(updated),
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 1, output: 'boom', durationMs: 5 }),
  })
  await runner.run(0, 'false', 't3')
  assert.equal(store.current.blocked?.reason, 'check-failed')
  assert.equal(store.current.blocked?.command, 'false')
  assert.ok(emitted.some(updated => updated?.blocked?.reason === 'check-failed'))
})

test('a rework turn with no new changes surfaces a blocked room instead of stalling', async () => {
  registerWorkspaceProvider('test-live-nochange', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: () => ({ diff: '', status: '', files: [], manifest: [] }),
    head: () => 'c1',
    submit: () => { throw new Error('submit should not run when there is no change') },
    isolatedCopy: () => { throw new Error('no copy should be made') },
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    workspace: { provider: 'test-live-nochange' },
    stageBases: { 0: 'base' },
    verifiers: [],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', { kind: 'rework', seq: 1, meta: { stage: 0 } })
  store.appendMessage('room-1', {
    kind: 'evidence', seq: 2, meta: { stage: 0, kind: 'command', command: 'true', exit: 0, head: 'c1' },
  })
  const emitted = []
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    emit: (_event, updated) => emitted.push(updated),
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 0, output: '', durationMs: 1 }),
  })
  await runner.run(0, 'true', 't2')
  assert.equal(store.current.blocked?.reason, 'no-progress')
  assert.equal(store.current.blocked?.stage, 0)
  assert.ok(emitted.some(updated => updated?.blocked?.reason === 'no-progress'))
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
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: 'm2' }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(review.isBusy(), true)
  assert.equal(sent[0].memberId, 'verifier')
  assert.equal(review.consume({ turn: { reply: 'PASS' }, memberId: 'verifier', turnId: 't1', room }), true)
  assert.equal(review.isBusy(), false)
  assert.ok(store.messages.some(message => message.kind === 'verdict' && message.meta.pass === true))
  assert.ok(store.messages.some(message => message.text === '全部验收员通过，这一步做完了。'))
})

test('critique review is blind to the execution conversation', async () => {
  const room = makeRoom({ verifiers: ['verifier'], orchestration: 'critique' })
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
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: 'm2' }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.match(sent[0].prompt, /对抗复核：只依据本轮证据/)
  assert.doesNotMatch(sent[0].prompt, /阶段进展/)
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
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: 'm2' }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(sent[0].memberId, 'verifier')
  assert.match(sent[0].prompt, /结果证据/)
  assert.doesNotMatch(sent[0].prompt, /验收命令：/)
  assert.equal(review.consume({ turn: { reply: 'PASS\nok' }, memberId: 'verifier', turnId: 't1', room }), true)
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
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => { runs += 1; return { exit: 0 } } },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ turnId: 't-chatter', reply: '收到，没有待办。', toolCalls: 0, tools: [] }, 'bot-worker')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(runs, 0)
  assert.equal(store.messages.some(message => message.meta?.kind === 'command'), false)
})

test('a failed auto check sends the step back instead of asking for sign-off', async () => {
  registerWorkspaceProvider('test-auto-fail', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: async () => ({ diff: 'diff', status: ' M a.js', files: ['a.js'], manifest: [] }),
    head: () => 'auto-fail-head',
    submit: () => 'auto-fail-candidate',
    isolatedCopy: () => ({ path: '/tmp/auto-fail-copy' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    stageBases: { 0: 'auto-fail-base' },
    workspace: { provider: 'test-auto-fail' },
  })
  const store = fakeStore(room)
  let asked = 0
  let failed = null
  const runner = createAcceptanceRunner({
    store,
    roomId: 'room-1',
    markProgress: () => {},
    requestReview: async () => { asked += 1 },
    run: async () => ({ exit: 1, output: 'boom' }),
    onAutoFail: info => { failed = info },
  })
  await runner.run(0, 'npm test', 't-fail', { auto: true, reason: 'package.json 里有 test 脚本' })
  assert.equal(asked, 0)
  assert.deepEqual(failed, { stageIndex: 0, command: 'npm test', exit: 1, output: 'boom' })
  const evidence = store.messages.find(message => message.meta?.auto === true)
  assert.equal(evidence.meta.exit, 1)
  assert.equal(store.messages.some(message => /退回重做/.test(message.text ?? '')), false)
})

test('a manual stage runs the check the repository itself declares', async () => {
  registerWorkspaceProvider('test-manual-autocheck', {
    capabilities: () => ({ acceptanceCopy: true, candidate: true }),
    changes: async () => ({ diff: 'diff', status: ' M a.js', files: ['a.js'], manifest: [] }),
    head: () => 'auto-head',
    submit: () => 'auto-candidate',
    isolatedCopy: () => ({ path: '/tmp/auto-copy' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    stageBases: { 0: 'auto-base' },
    workspace: { provider: 'test-manual-autocheck' },
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', manual: true }],
    workers: ['worker'],
    verifiers: [],
    seatBots: { worker: 'bot-worker' },
    seatSpecs: [{ id: 'worker', name: 'Worker', role: 'worker' }],
  })
  const store = fakeStore(room)
  let ran = ''
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async ({ command }) => { ran = command; return { exit: 0, output: 'ok' } } },
    files: {
      exists: path => path.endsWith('package.json'),
      read: path => path.endsWith('package.json') ? Buffer.from('{"scripts":{"test":"vitest run"}}') : Buffer.from(''),
    },
  })
  turns.captureTurn({ turnId: 't-auto', reply: '改完了', toolCalls: 1, tools: [{ id: 'write' }] }, 'bot-worker')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(ran, 'npm test')
  const evidence = store.messages.find(message => message.meta?.kind === 'command' && message.meta?.auto === true)
  assert.ok(evidence)
  assert.equal(evidence.meta.command, 'npm test')
  assert.match(evidence.meta.detected, /test 脚本/)
  assert.ok(store.messages.some(message => /自动检查通过/.test(message.text ?? '')))
})

test('a manual stage says when there is no check to run', async () => {
  registerWorkspaceProvider('test-manual-nocheck', {
    capabilities: () => ({ candidate: true }),
    head: () => 'nocheck-head',
    submit: () => 'nocheck-candidate',
    changes: async () => ({ diff: 'diff', status: ' M a.js', files: ['a.js'], manifest: [] }),
  })
  const room = makeRoom({
    repoPath: '/repo',
    sourceRepo: '/repo',
    stageBases: { 0: 'nocheck-base' },
    workspace: { provider: 'test-manual-nocheck' },
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', manual: true }],
    workers: ['worker'],
    verifiers: [],
    seatBots: { worker: 'bot-worker' },
    seatSpecs: [{ id: 'worker', name: 'Worker', role: 'worker' }],
  })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({ exit: 0 }) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.captureTurn({ turnId: 't-nocheck', reply: '改完了', toolCalls: 1, tools: [{ id: 'write' }] }, 'bot-worker')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(store.messages.some(message => /没有可自动运行的检查/.test(message.text ?? '')))
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
    sendToMember: async () => ({ messageId: null }),
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
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
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
  assert.equal(review.consume({ turn: { reply: 'REJECT old' }, memberId: 'verifier', turnId: 't-old', room }), false)
  assert.equal(review.consume({ turn: { reply: 'PASS new' }, memberId: 'verifier', turnId: 't-new', room }), true)
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
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  assert.equal(review.consume({ turn: { reply: 'REJECT\n证据不足' }, memberId: 'verifier', turnId: 't1', room }), true)
  assert.equal(room.closure, 'executing')
  const planner = sent.find(item => item.memberId === 'planner')
  assert.ok(planner)
  assert.match(planner.prompt, /验收员退回了第 1 步/)
  assert.match(planner.prompt, /证据不足/)
  assert.match(planner.prompt, /第一行只写「返工」或「交给人」/)
  assert.match(planner.prompt, /在话里 @ 执行成员/)
  assert.match(planner.prompt, /lodge-internal/)
})


test('shadow review records advice without injecting it into the Verifier prompt', async () => {
  const room = makeRoom({ verifiers: ['verifier'], shadowReview: true, shadowBot: { memberRef: 'bot-shadow', name: 'ShadowReview1' } })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: '' },
  })
  const sent = []
  let calls = 0
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: 'm2' }
    },
    shadow: {
      ask: async () => {
        calls += 1
        return { available: true, advice: [{ source: 'shadow', summary: '建议补一条回滚测试', reasons: ['缺少回滚测试'] }] }
      },
    },
  })
  await review.request(0)
  await review.shadowSettled()
  assert.equal(calls, 1)
  assert.doesNotMatch(sent[0].prompt, /回滚测试/)
  assert.doesNotMatch(sent[0].prompt, /影子评审/)
  const advice = store.readRoom().advisorShadow?.[0]
  assert.ok(advice)
  assert.equal(advice.evidenceId, store.messages.find(message => message.kind === 'evidence').id)
  assert.equal('score' in advice.advice[0], false)
  assert.equal(store.messages.some(message => message.kind === 'verdict'), false)
})

test('a shadow opinion still lands after its stage has passed', async () => {
  const room = makeRoom({ verifiers: ['verifier'], shadowReview: true, shadowBot: { memberRef: 'bot-shadow', name: 'ShadowReview1' } })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: '' },
  })
  let release = null
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: 'm2' }),
    shadow: {
      ask: () => new Promise(resolve => {
        release = () => resolve({ available: true, advice: [{ source: 'shadow', summary: '补一个反例', reasons: ['边界未测'] }] })
      }),
    },
  })
  await review.request(0)
  store.readRoom().stages[0].state = 'passed'
  release()
  await review.shadowSettled()
  assert.ok(store.readRoom().advisorShadow?.[0])
})

test('shadow review stays quiet when the check is strong and nothing points at risk', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0, output: '', diff: '', changedFiles: ['a.js'] },
  })
  let calls = 0
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: 'm2' }),
    shadow: { ask: async () => { calls += 1; return { available: true, advice: [] } } },
  })
  await review.request(0)
  await review.shadowSettled()
  assert.equal(calls, 0)
  assert.equal(store.readRoom().advisorShadow, undefined)
})

test('shadow review says once when the reviewer could not answer', async () => {
  const room = makeRoom({ verifiers: ['verifier'], shadowReview: true })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'command', command: 'true', exit: 0, output: '', diff: '' },
  })
  const review = createReviewCoordinator({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: 'm2' }),
    shadow: { ask: async () => ({ available: false, advice: [], error: 'timeout' }) },
  })
  await review.request(0)
  await review.shadowSettled()
  assert.ok(store.messages.some(message => message.meta?.advisorFailed === true))
  assert.equal(store.readRoom().advisorShadow, undefined)
})

test('restart wakes an assignment that never reported', async () => {
  const room = makeRoom({ live: true, busy: false })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-open', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'sent', context: {}, flags: {},
  })
  const sent = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.resume()
  assert.ok(sent.some(item => item.memberId === 'executor'))
})


test('integration commits the merged tree before the acceptance copy', async () => {
  let copiedRef = ''
  registerWorkspaceProvider('test-integration-candidate', {
    capabilities: () => ({ merge: true, candidate: true }),
    integrate: () => ({ ok: true, files: [] }),
    submit: () => 'cand-1',
    head: () => 'head-1',
    rangeChanges: async () => ({ diff: '', files: ['a.js'], manifest: [] }),
    isolatedCopy: ({ ref }) => { copiedRef = ref; return { path: '/tmp/copy' } },
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    workspace: { provider: 'test-integration-candidate' },
    repoPath: '/repo',
    sourceRepo: '/src',
    branches: { executor: 'crew/room/executor' },
    worktrees: { executor: '/wt/executor' },
  })
  const store = fakeStore(room)
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 0, output: '', durationMs: 1 }),
  })
  await integrator.integrate({ stageIndex: 0, workers: ['executor'], base: 'head-0', turnId: 't1' })
  assert.equal(copiedRef, 'cand-1')
  assert.ok(store.messages.some(message => message.kind === 'evidence' && message.meta?.exit === 0))
})

test('an integration check failure leaves evidence and does not start review', async () => {
  registerWorkspaceProvider('test-integration-check', {
    capabilities: () => ({ merge: true }),
    integrate: () => ({ ok: true, files: [] }),
    head: () => 'head-1',
    rangeChanges: async () => ({ diff: '', files: ['hello.txt'], manifest: [] }),
    isolatedCopy: () => ({ root: '/tmp/lodge-copy', path: '/tmp/lodge-copy/ws' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    workspace: { provider: 'test-integration-check' },
    repoPath: '/repo',
    sourceRepo: '/src',
    branches: { executor: 'crew/room/executor' },
    worktrees: { executor: '/wt/executor' },
  })
  const store = fakeStore(room)
  let reviewed = 0
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    markProgress: () => {},
    requestReview: async () => { reviewed += 1 },
    run: async () => ({ exit: 1, output: 'failed', durationMs: 5, sandbox: true }),
  })
  await integrator.integrate({ stageIndex: 0, workers: ['executor'], base: 'head-0', turnId: 't1' })
  const evidence = store.messages.find(message => message.kind === 'evidence')
  assert.equal(evidence.meta.exit, 1)
  assert.equal(reviewed, 0)
  assert.ok(store.messages.some(message => /检查没通过/.test(message.text ?? '')))
})

test('a merge conflict stops integration with a concrete room conflict', async () => {
  let merges = 0
  registerWorkspaceProvider('test-integration-conflict', {
    capabilities: () => ({ merge: true }),
    integrate: () => {
      merges += 1
      return { ok: false, files: ['src/app.js'] }
    },
    head: () => 'head-1',
    rangeChanges: async () => ({ diff: '', files: [], manifest: [] }),
    isolatedCopy: () => ({ root: '/tmp/lodge-copy', path: '/tmp/lodge-copy/ws' }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    workspace: { provider: 'test-integration-conflict' },
    repoPath: '/repo',
    sourceRepo: '/src',
    branches: { executor: 'crew/room/executor' },
    worktrees: { executor: '/wt/executor' },
  })
  const store = fakeStore(room)
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 0 }),
  })
  await integrator.integrate({ stageIndex: 0, workers: ['executor'], base: 'head-0', turnId: 't1' })
  assert.equal(store.current.mergeConflict.files[0], 'src/app.js')
  assert.equal(store.messages.some(message => message.kind === 'evidence'), false)
  // 冲突挂着时，后续回合不能再自动试一次合并，把人的决定挤掉。
  await integrator.integrate({ stageIndex: 0, workers: ['executor'], base: 'head-0', turnId: 't2' })
  assert.equal(merges, 1)
})


test('an unavailable isolated copy stops integration without inventing evidence', async () => {
  registerWorkspaceProvider('test-integration-copy-fail', {
    capabilities: () => ({ merge: true }),
    integrate: () => ({ ok: true, files: [] }),
    head: () => 'head-1',
    rangeChanges: async () => ({ diff: '', files: [], manifest: [] }),
    isolatedCopy: () => { throw new Error('no copy') },
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    workspace: { provider: 'test-integration-copy-fail' },
    repoPath: '/repo',
    sourceRepo: '/src',
    branches: { executor: 'crew/room/executor' },
    worktrees: { executor: '/wt/executor' },
  })
  const store = fakeStore(room)
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    markProgress: () => {},
    requestReview: async () => {},
    run: async () => ({ exit: 0 }),
  })
  await integrator.integrate({ stageIndex: 0, workers: ['executor'], base: 'head-0', turnId: 't1' })
  assert.equal(store.messages.some(message => message.kind === 'evidence'), false)
  assert.ok(store.messages.some(message => /集成检查没跑成/.test(message.text ?? '')))
})
