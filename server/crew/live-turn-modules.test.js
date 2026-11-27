import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { createHandoff } from './rooms/studio/delivery/handoff.js'
import { createStageIntegrator } from './rooms/studio/delivery/integration.js'
import { createReviewCoordinator } from './rooms/studio/acceptance/review.js'
import { createStageStarter } from './rooms/studio/plan/stage.js'
import { createLiveTurns } from './rooms/studio/runtime/turns.js'
import { createTurnState } from './rooms/studio/plan/turn-state.js'
import { REVIEW_TIMEOUT, deliverableStageIndex, parsePlannerDecision } from './rooms/studio/runtime/turn-utils.js'
import { normalizeJudgment } from '../../shared/judgment.js'
import { registerWorkspaceProvider } from './workspace.js'
import { withAssignments } from './testing/room.js'

// 判定文本的契约在 shared/judgment.js；这里只验证首行锚点的语义。
const parseVerdict = reply => normalizeJudgment({ type: 'verdict', text: reply }).decision === 'pass'

const rejectMeta = stage => ({
  pass: false,
  stage,
  judgment: {
    version: 1,
    type: 'verdict',
    decision: 'reject',
    reason: '',
    findings: [],
    actionRequired: '',
    stage,
    evidenceId: null,
    actorId: 'verifier',
    rejectTo: 'planner',
    at: 0,
    source: 'text',
  },
})

const proofCall = { name: 'Bash', step: { target: 'npm test' } }

const makeRoom = overrides => ({
  id: 'room-1',
  roomType: 'studio',
  name: 'Room',
  goal: 'ship it',
  state: 'active',
  stages: [{ title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' }],
  members: [
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', name: 'Verifier' } },
    ],
  workers: ['executor'],
  verifiers: [],
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
    readMessage: (roomId, id) => messages.find(item => item.id === id) ?? null,
    readMessages: () => messages,
    upsertMessage: message => {
      const index = messages.findIndex(item => item.id === message.id)
      if (index >= 0) messages[index] = message
      return message
    },
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

test('live turn helpers keep stage and verdict semantics', async () => {
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

test('a rejected stage routes the planner decision to the executor or the human', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-old', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    roomType: 'studio',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
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
  await turns.captureTurn({ reply: '返工\n改成写入欢迎语', turnId: 't-lead-1', toolCalls: 0 }, 'bot-plan')
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
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
  })
  const humanStore = fakeStore(humanRoom)
  humanStore.writeAssignment({
    id: 'as-human', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    roomType: 'studio',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  humanStore.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
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
  await humanTurns.captureTurn({ reply: '交给人\n需要你决定权限', turnId: 't-lead-2', toolCalls: 0 }, 'bot-plan')
  assert.equal(humanSent.length, 0)
  assert.equal(humanRoom.lastPlannerDecision.kind, 'human')
  assert.equal(humanStore.readAssignment('as-human').status, 'rejected')
  assert.equal(humanStore.messages.some(message => message.kind === 'system' && /规划师把/.test(message.text)), false)
})

test('a planner gate call decides without parsing the reply', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
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
  turns.trackTool({
    kind: 'activity',
    turnId: 't-lead-gate',
    tool: {
      id: 'call-gate',
      name: 'mcp__lodge_gate__submit_decision',
      input: JSON.stringify({ decision: 'human', reason: '权限要你定', actionRequired: '选一个权限' }),
    },
  })
  await turns.captureTurn({ reply: '已提交', turnId: 't-lead-gate', toolCalls: 1 }, 'bot-plan')
  assert.equal(room.lastPlannerDecision.kind, 'human')
  assert.equal(room.lastPlannerDecision.judgment.source, 'gate')
  assert.equal(room.lastPlannerDecision.judgment.actionRequired, '选一个权限')
  assert.equal(sent.length, 0)
})

test('a lead plan call hands the proposal to the platform without an @', async () => {
  const room = makeRoom({
    stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: 'active' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
    ],
    workers: [],
    // 上一次没交出队伍留下的停住标记：补交上方案之后就该消失。
    blocked: { stage: 0, reason: 'plan', at: 1 },
  })
  const store = fakeStore(room)
  const sent = []
  const applied = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => { sent.push({ memberId, prompt }); return { messageId: null } },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    applyPlan: async (roomId, result) => { applied.push({ roomId, result }) },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-plan',
    tool: {
      id: 'call-plan',
      name: 'mcp__lodge_gate__submit_plan',
      input: JSON.stringify({
        contract: {
          outcomes: [{ id: 'run', statement: '能跑', observable: '测试退出码为 0' }],
          boundaries: ['不改接口'],
          nonGoals: ['不加新功能'],
        },
        plan: {
          stages: [{
            title: '实现',
            deliverable: 'tests pass',
            clauseIds: ['run'],
            packages: [{ title: '实现', files: ['src/index.js'], clauseIds: ['run'] }],
          }],
        },
        crew: { executors: [{ engine: 'claude', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
      }),
    },
  })
  await turns.captureTurn({ reply: '方案和队伍已提交', turnId: 't-plan', toolCalls: 1 }, 'bot-planner')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(applied.length, 1)
  assert.equal(applied[0].roomId, 'room-1')
  assert.equal(applied[0].result.proposal.crew.verifiers[0].engine, 'pi')
  assert.equal(sent.length, 0)
  assert.equal(store.readRoom('room-1').blocked, null)
})

test('a plan that never lands leaves the room waiting visibly, not "running"', async () => {
  const room = makeRoom({
    stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: 'active' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
    ],
    workers: [],
  })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    // 现场：基座超时、组队没落地。房间不能说“进行中”然后什么都不做。
    applyPlan: async () => { throw new Error('The operation was aborted due to timeout') },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-plan',
    tool: {
      id: 'call-plan',
      name: 'mcp__lodge_gate__submit_plan',
      input: JSON.stringify({
        contract: {
          outcomes: [{ id: 'run', statement: '能跑', observable: '测试退出码为 0' }],
          boundaries: [], nonGoals: [],
        },
        plan: { stages: [{ title: '实现', deliverable: 'tests pass', clauseIds: ['run'], packages: [{ title: '实现', files: ['src/index.js'], clauseIds: ['run'] }] }] },
        crew: { executors: [{ engine: 'claude', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
      }),
    },
  })
  await turns.captureTurn({ reply: '方案已提交', turnId: 't-plan', toolCalls: 1 }, 'bot-planner')
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(store.readRoom('room-1').blocked?.reason, 'setup')
})

test('a bootstrap planner that forgets submit_plan is nudged once, then surfaced', async () => {
  const room = makeRoom({
    stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: 'active' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
    ],
    workers: [],
  })
  const store = fakeStore(room)
  const sent = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => { sent.push({ memberId, prompt }); return { messageId: null } },
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({ reply: '我先分析一下。', turnId: 't-no-plan-1', toolCalls: 0 }, 'bot-planner')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 1)
  assert.match(sent[0].prompt, /submit_plan/)
  assert.match(sent[0].prompt, /不要继续分析/)

  await turns.captureTurn({ reply: '还在分析。', turnId: 't-no-plan-2', toolCalls: 0 }, 'bot-planner')
  assert.match(String(store.messages.at(-1)?.text ?? ''), /还没有提交队伍/)
  // 说了停就要真的停：房间不能还挂在“进行中”，让界面和评测以为有人在做。
  assert.equal(store.readRoom('room-1').blocked?.reason, 'plan')
  assert.equal(store.readRoom('room-1').blocked?.stage, 0)
})

test('a lead model change goes to the platform as three fields', async () => {
  const room = makeRoom({
    stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: 'active' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
    ],
    workers: [],
  })
  const store = fakeStore(room)
  const changes = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    adjustModel: async (roomId, request) => { changes.push({ roomId, request }) },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-model',
    tool: {
      id: 'call-model',
      name: 'mcp__lodge_gate__adjust_member_model',
      input: JSON.stringify({ member: '执行官', engine: 'pi', model: 'deepseek-flash', why: '登录失效' }),
    },
  })
  await turns.captureTurn({ reply: '换了模型', turnId: 't-model', toolCalls: 1 }, 'bot-planner')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(changes[0].request, { member: '执行官', engine: 'pi', model: 'deepseek-flash', why: '登录失效' })
})

test('asking a decision pauses every member except the planner', async () => {
  const room = makeRoom({
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', deliverable: 'a result' },
      { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
    ],
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  const attended = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    setMembers: async (_roomId, ids) => {
      attended.push(ids)
      return ids
    },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-ask',
    tool: {
      id: 'call-ask',
      name: 'mcp__lodge_gate__ask_decision',
      input: JSON.stringify({
        question: '走哪条路？',
        options: [
          { id: 'a', title: 'A', effect: '走 A 会得到什么' },
          { id: 'b', title: 'B', effect: '走 B 会得到什么' },
        ],
        recommended: 'a',
      }),
    },
  })
  await turns.captureTurn({ turnId: 't-ask', reply: '等你选', toolCalls: 1 }, 'bot-planner')
  assert.deepEqual(attended, [['planner']])
  assert.equal(store.current.pendingDecision.status, 'open')
})

test('a planner question pauses the room without a decision card', async () => {
  const room = makeRoom({
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', deliverable: 'a result' },
      { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
    ],
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
    pendingDecision: null,
  })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-question',
    tool: {
      id: 'call-question',
      name: 'mcp__lodge_gate__ask_question',
      input: JSON.stringify({ question: '上次说的版式是哪一版？' }),
    },
  })
  await turns.captureTurn({ turnId: 't-question', reply: '问一句', toolCalls: 1 }, 'bot-planner')
  assert.equal(store.current.openQuestion, '上次说的版式是哪一版？')
  assert.equal(store.current.pendingDecision, null)
})

test('a planner stop request really stops the round', async () => {
  const room = makeRoom({
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', deliverable: 'a result' },
      { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
    ],
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
    pendingDecision: null,
  })
  const store = fakeStore(room)
  const stopped = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    stopRound: (roomId, request) => {
      stopped.push([roomId, request])
      return Promise.resolve({ ok: true })
    },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-stop',
    tool: {
      id: 'call-stop',
      name: 'mcp__lodge_gate__stop_round',
      input: JSON.stringify({ reason: '用户说停下' }),
    },
  })
  await turns.captureTurn({ turnId: 't-stop', reply: '已停。', toolCalls: 1 }, 'bot-planner')
  await turns.captureTurn({ turnId: 't-stop', reply: '已停。', toolCalls: 1 }, 'bot-planner')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(stopped, [['room-1', { reason: '用户说停下' }]])
})

test('a stop advice waits for an in-flight assignment instead of cutting it off', async () => {
  const room = makeRoom({
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', deliverable: 'a result' },
      { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
    ],
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-live', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'sent', context: {}, flags: {},
  })
  const stopped = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    stopRound: (roomId, request) => {
      stopped.push([roomId, request])
      return Promise.resolve({ ok: true })
    },
  })
  const advice = turns.adviseStop({ reason: '不值得继续' })
  assert.equal(advice?.deferred, true)
  assert.deepEqual(stopped, [])
  assert.ok(store.messages.some(message => /规划师建议停下/.test(message.text ?? '')))
  // 在跑的那一位交回之后，系统才停。
  store.writeAssignment({
    id: 'as-live', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    roomType: 'studio',
    brief: {}, status: 'reported', context: {}, flags: {},
  })
  await turns.maybeStop()
  assert.deepEqual(stopped, [['room-1', { reason: '不值得继续' }]])
})

test('a planner resume request reopens the stopped round', async () => {
  const room = makeRoom({
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', deliverable: 'a result' },
      { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
    ],
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
    pendingDecision: null,
  })
  const store = fakeStore(room)
  const resumed = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    resumeRound: roomId => {
      resumed.push(roomId)
      return { ok: true, body: { round: { id: 'round-1' } } }
    },
  })
  turns.trackTool({
    kind: 'activity',
    turnId: 't-resume',
    tool: { id: 'call-resume', name: 'mcp__lodge_gate__resume_round', input: '{}' },
  })
  await turns.captureTurn({ turnId: 't-resume', reply: '好，接着做。', toolCalls: 1 }, 'bot-planner')
  await turns.captureTurn({ turnId: 't-resume', reply: '好，接着做。', toolCalls: 1 }, 'bot-planner')
  assert.deepEqual(resumed, ['room-1'])
})

test('reconnecting after the card is answered does not reopen the room chat', async () => {
  const room = makeRoom({
    pendingDecision: {
      id: 'd-old',
      status: 'answered',
      question: '走哪条路？',
      options: [{ id: 'a', title: 'A', effect: 'A' }, { id: 'b', title: 'B', effect: 'B' }],
      recommended: 'a',
    },
  })
  const store = fakeStore(room)
  const attended = []
  createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    setMembers: async (_roomId, ids) => {
      attended.push(ids)
      return ids
    },
  })
  assert.deepEqual(attended, [])
})

test('reconnecting while the card is open leaves only the planner in the room chat', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    pendingDecision: {
      id: 'd-open',
      status: 'open',
      question: '走哪条路？',
      options: [{ id: 'a', title: 'A', effect: 'A' }, { id: 'b', title: 'B', effect: 'B' }],
      recommended: 'a',
    },
  })
  const store = fakeStore(room)
  const attended = []
  createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    setMembers: async (_roomId, ids) => {
      attended.push(ids)
      return ids
    },
  })
  assert.deepEqual(attended, [['planner']])
})

test('a planner summary after a passed verdict closes the last step without another click', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
    stages: [
      { title: '写一句说明', kind: 'deliverable', state: 'active', deliverable: 'a result' },
      { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
    ],
  })
  const store = fakeStore(room)
  store.messages.push({ id: 'v-pass', kind: 'verdict', meta: { pass: true, stage: 0 } })
  const closed = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    confirmStage: async (_roomId, stage, options) => { closed.push([stage, options]); return { ok: true } },
  })
  await turns.captureTurn({ turnId: 't-summary', reply: '这一步做完了，验收也过了。', toolCalls: 0 }, 'bot-planner')
  assert.deepEqual(closed, [[0, { by: 'system' }]])
})

test('a planner turn without a submitted decision is nudged once, then handed to the human', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
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
  await turns.captureTurn({ reply: '验收员判了没过，需要你拍板', turnId: 't-lead-1', toolCalls: 0 }, 'bot-plan')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].memberId, 'planner')
  assert.match(sent[0].prompt, /submit_decision/)
  assert.equal(room.lastPlannerDecision, undefined)

  await turns.captureTurn({ reply: '还是需要你拍板', turnId: 't-lead-2', toolCalls: 0 }, 'bot-plan')
  assert.equal(room.lastPlannerDecision.kind, 'human')
  assert.equal(room.lastPlannerDecision.judgment.source, 'missing')
  assert.match(room.lastPlannerDecision.judgment.actionRequired, /没有提交决定/)
  assert.ok(store.events.some(event => event.type === 'handoff.human'))
})

test('an exhausted rework budget asks the human instead of reworking again', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
  })
  for (const at of [1, 2, 3]) {
    store.appendMessage('room-1', {
      kind: 'rework', authorId: 'system', text: `重做 ${at}`, meta: { stage: 0, source: 'planner' },
    })
  }
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({ reply: '返工\n再改一次', turnId: 't-lead-budget', toolCalls: 0 }, 'bot-plan')
  assert.equal(room.lastPlannerDecision.kind, 'human')
  assert.equal(room.lastPlannerDecision.judgment.source, 'policy')
  assert.match(room.lastPlannerDecision.judgment.actionRequired, /重做次数/)
  assert.equal(store.messages.filter(message => message.kind === 'rework' && message.meta?.stage === 0).length, 3)
  assert.ok(store.events.some(event => event.type === 'handoff.human'))
})

test('a review request always gets one system handoff, even if the executor wrote @', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  // 执行官最后一句已经按规矩 @ 了验收员。
  store.appendMessage('room-1', {
    kind: 'chat',
    authorId: 'executor',
    text: '改完了，@验收员 麻烦看一下这版。',
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  assert.deepEqual(sent.map(item => item.memberId), ['verifier'])
  assert.equal(store.messages.filter(message => (
    message.meta?.kind === 'handoff' && message.meta?.reason === 'review'
  )).length, 1)
})

test('a verifier reply without a verdict is nudged, then expires the review', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt, options = {}) => {
      sent.push({ memberId, prompt, options })
      return { messageId: `m${sent.length}` }
    },
    updateTasks: () => {},
  })
  await review.request(0)
  const projection = store.messages.find(message => (
    message.meta?.kind === 'handoff' && message.meta?.reason === 'review'
  ))
  assert.match(projection.text, /@验收员 第 1 步「impl」结果好了，请复核/)
  // 系统发的交接带着身份标记：它写着执行官的名字，但说话的是系统。
  assert.equal(projection.meta.authorKind, 'system')
  assert.equal(await review.consume({
    turn: { reply: '我看了证据，还需要再看看' },
    memberId: 'verifier',
    turnId: 't1',
    room,
  }), true)
  assert.equal(review.isBusy(), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /submit_verdict/)
  // 催问也不能回到群里：否则验收员下一次醒来的上下文就又带上了执行对话。
  assert.equal(sent.at(-1).options.privateRoom, true)

  assert.equal(await review.consume({
    turn: { reply: '还是没结论' },
    memberId: 'verifier',
    turnId: 't2',
    room,
  }), true)
  // 第二次仍然只催“交判定”；第三次都没有才收口。
  assert.equal(review.isBusy(), true)
  assert.equal(await review.consume({
    turn: { reply: '还是没有' },
    memberId: 'verifier',
    turnId: 't3',
    room,
  }), true)
  assert.equal(review.isBusy(), false)
  assert.ok(store.messages.some(message => message.meta?.kind === 'review_timeout'))
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
})

test('a PASS on a delivery whose proof cannot rerun goes back to the executor', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    authorId: 'executor',
    kind: 'evidence',
    meta: {
      stage: 0,
      kind: 'result',
      diff: '',
      changedFiles: ['hello.txt'],
      proof: { status: 'failed', error: '证明的 step 没跑绿：read hello.txt' },
    },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({ decision: 'PASS', reason: '好', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], falsify: [{ command: 'node --test' }] }), proofCall],
  }), true)
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict.meta.pass, false)
  assert.match(verdict.text, /复核副本里没有跑绿/)
  assert.equal(verdict.meta.judgment.platformRejected, 'proof')
  const rework = store.messages.find(message => message.kind === 'rework')
  assert.equal(rework.meta.source, 'platform')
  assert.match(rework.meta.note, /read hello\.txt/)
  // 退回直接进执行官手里，不把房间停在“等人点重试”。
  assert.ok(sent.some(item => item.memberId === 'executor' && item.prompt.includes('read hello.txt')))
  assert.equal(review.isBusy(), false)
})

test('a counterexample that runs red on the delivery is a reject, even if the verifier says PASS', async () => {
  // 真房：验收员自己跑出了反例，却还是提交 PASS。平台亲手跑出来的事实不能被判定改掉。
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    authorId: 'executor',
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', diff: '', changedFiles: ['hello.txt'] },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: ({ command }) => (String(command).includes('rm -rf hello.txt')
      ? { status: 'failed', exit: 1 }
      : { status: 'passed', exit: 0 }),
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
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  const submit = turnId => review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId,
    room,
    calls: [call({
      decision: 'PASS',
      reason: '我看行',
      outsideDiff: '无',
      coverage: [{ item: 'ship it', evidence: '读了改动文件' }],
      falsify: [{ command: 'rm -rf hello.txt' }],
    }), proofCall],
  })
  // 第一次：先把红的命令交回验收员——它可能是在故意测“坏输入要被抓住”。
  assert.equal(await submit('t1'), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /跑红/)
  // 第二次仍然红：按平台跑出来的事实拒收。
  assert.equal(await submit('t2'), true)
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict?.meta?.pass, false)
  assert.equal(verdict?.meta?.judgment?.platformRejected, 'falsify')
  assert.match(verdict?.text ?? '', /反例在交付上跑红/)
  assert.equal(store.messages.find(message => message.kind === 'rework')?.meta?.source, 'platform')
  assert.equal(review.isBusy(), false)
})

test('a counterexample that builds both states itself is recorded, not rejected', async () => {
  // 真房：验收员的命令自己 git archive 旧版本再补上新检查，两边都绿是对的。
  // 平台只认“在交付上跑红”这个事实；这条命令够不够狠是验收员的判断，记进证据给人看。
  registerWorkspaceProvider('test-both-green', {
    capabilities: () => ({}),
    isolatedCopy: ({ ref }) => ({ path: `/base-${ref}` }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    verifiers: ['verifier'],
    workspace: { provider: 'test-both-green' },
    repoPath: '/repo',
    worktrees: { verifier: '/verifier' },
    stageBases: { 0: 'base1' },
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    authorId: 'executor',
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', diff: '', changedFiles: ['hello.txt'] },
  })
  const command = 'tmp=$(mktemp -d) && git archive HEAD | tar -x -C "$tmp" && cp tools/check.mjs "$tmp/" && node "$tmp/check.mjs"'
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed', exit: 0 }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => ({ messageId: `${memberId}-${prompt.length}` }),
    updateTasks: () => {},
  })
  await review.request(0)
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({
      decision: 'PASS',
      reason: '旧版本上 check.mjs 确实红',
      outsideDiff: '无',
      coverage: [{ item: 'ship it', evidence: '读了改动文件' }],
      falsify: [{ command, note: '旧版本里没有 hello.txt，check.mjs 跑红' }],
    }), proofCall],
  })
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict?.meta?.pass, true)
  assert.equal(verdict?.meta?.judgment?.falsifyRuns?.[0]?.command, command)
  assert.equal(verdict?.meta?.judgment?.falsifyRuns?.[0]?.run?.status, 'passed')
  assert.equal(verdict?.meta?.judgment?.falsifyRuns?.[0]?.base?.status, 'passed')
})

test('a review times out on silence, not on work', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const room = makeRoom({
      verifiers: ['verifier'],
    })
    const store = fakeStore(room)
    store.appendMessage('room-1', {
      kind: 'evidence',
      meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
    })
    const review = createReviewCoordinator({
      runCommand: () => ({ status: 'passed' }),
      store,
      roomId: 'room-1',
      emit: () => {},
      sendToMember: async () => ({ messageId: 'm1' }),
      updateTasks: () => {},
    })
    await review.request(0)
    // 验收员还在跑命令：房间里能看到它自己的活动，就不算沉默。
    store.appendMessage('room-1', {
      kind: 'activity',
      authorId: 'verifier',
      text: 'bash',
      ts: Date.now() + 60_000,
    })
    mock.timers.tick(REVIEW_TIMEOUT)
    assert.ok(!store.messages.some(message => message.meta?.kind === 'review_timeout'), '还在干活时不超时')
    mock.timers.tick(REVIEW_TIMEOUT)
    assert.ok(store.messages.some(message => message.meta?.kind === 'review_timeout'), '真沉默满一个窗口才结束')
    assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  } finally {
    mock.timers.reset()
  }
})

test('a text verdict is judged by the same checks as a tool verdict', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  room.members.find(member => member.id === 'verifier').body.roomTools = ['lodge_gate']
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '', changedFiles: ['README.md'] },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  // 只写了“通过”、没有判定 json：通道是自由的，但覆盖表、反例这些检查一样要过。
  assert.equal(await review.consume({
    turn: { reply: '通过，没问题。' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [{ name: 'Read', step: { target: 'README.md' } }],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /diff 之外|覆盖表|coverage/)
  // 文本 json 带全了判定内容，且这一回合真的读过改动文件：和工具提交一样算数。
  const verdictJson = JSON.stringify({
    decision: 'PASS',
    reason: '好',
    outsideDiff: '无',
    coverage: [{ item: 'ship it', evidence: '读了 README.md' }],
    falsify: [{ command: 'node --test' }],
  })
  assert.equal(await review.consume({
    turn: { reply: `通过\n\n\`\`\`json\n${verdictJson}\n\`\`\`` },
    memberId: 'verifier',
    turnId: 't2',
    room,
    calls: [{ name: 'Read', step: { target: 'README.md' } }],
  }), true)
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict?.meta?.pass, true)
  assert.equal(verdict?.meta?.judgment?.source, 'json')
})

test('a text verdict acknowledges protected files in the same json as a tool verdict', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '', changedFiles: ['package.json'] },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const textOf = extra => `通过\n\n\`\`\`json\n${JSON.stringify({
    decision: 'PASS',
    reason: '好',
    outsideDiff: '无',
    coverage: [{ item: 'ship it', evidence: '读了改动文件' }],
    falsify: [{ command: 'node --test' }],
    ...extra,
  })}\n\`\`\``
  // 文本通道也一样要逐条确认受保护文件；不能因为没走工具就跳过。
  assert.equal(await review.consume({
    turn: { reply: textOf({}) },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [{ name: 'Read', step: { target: 'package.json' } }],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /package\.json/)
  assert.match(sent.at(-1).prompt, /protectedFiles/)
  assert.equal(await review.consume({
    turn: { reply: textOf({ protectedFiles: ['package.json'] }) },
    memberId: 'verifier',
    turnId: 't2',
    room,
    calls: [{ name: 'Read', step: { target: 'package.json' } }],
  }), true)
  assert.equal(store.messages.find(message => message.kind === 'verdict')?.meta?.pass, true)
})

test('a deliverable review is blind to the executor narrative by default', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', { kind: 'chat', authorId: 'executor', text: '我把实现改好了，测试也过了。' })
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: 'ok', diff: 'diff --git a/a b/a' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt, options = {}) => { sent.push({ memberId, prompt, options }); return { messageId: 'm1' } },
    updateTasks: () => {},
  })
  await review.request(0)
  // 盲评是投递边界：复核信只进验收员自己的线程，群里的执行对话不会顺手进上下文。
  assert.equal(sent.at(-1).options.privateRoom, true)
  assert.match(sent.at(-1).prompt, /对抗复核/)
  assert.match(sent.at(-1).prompt, /先核对结果是否成立/)
  assert.match(sent.at(-1).prompt, /目标之外的重构/)
  assert.doesNotMatch(sent.at(-1).prompt, /证据摘要|进度：/)
})

test('a verdict cannot pass protected files without naming them', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: {
      stage: 0,
      kind: 'result',
      diff: '',
      changedFiles: ['package.json'],
    },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({ decision: 'PASS', reason: '改好了', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }] }), proofCall],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /受保护文件/)
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't2',
    room,
    calls: [call({ decision: 'PASS', reason: '改好了', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], protectedFiles: ['package.json'], falsify: [{ command: 'node --test' }] }), proofCall],
  }), true)
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict?.meta?.pass, true)
})

test('a PASS is refused when the delivery carries no re-runnable proof', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: { stage: 0, kind: 'result', diff: '', changedFiles: ['hello.txt'], proof: { status: 'missing' } },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({ decision: 'PASS', reason: '好', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], falsify: [{ command: 'node --test' }] }), proofCall],
  }), true)
  // 证明不能重跑就不通过，而且直接退回执行官补证明：房间不等人点重试。
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict.meta.pass, false)
  assert.match(verdict.text, /复核副本里没有跑绿/)
  assert.ok(store.messages.some(message => message.kind === 'rework'))
  assert.ok(sent.some(item => item.memberId === 'executor'))
})

test('a PASS must cover the stage deliverable before it counts', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: { stage: 0, kind: 'result', diff: '', changedFiles: ['README.md'] },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  assert.match(sent[0].prompt, /PASS 必须逐条覆盖/)
  assert.match(sent[0].prompt, /ship it/)
  const call = coverage => ({
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: '好了', outsideDiff: '无', coverage }),
  })
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call([{ item: '别的要求', evidence: '读了 README.md' }]), proofCall],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /ship it/)
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't2',
    room,
    calls: [call([{ item: '别的要求', evidence: '读了 README.md' }]), proofCall],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.ok(store.messages.some(message => (
    message.kind === 'system' && /没有逐条覆盖/.test(message.text ?? '')
  )))
  // 交不出有效判定也是一次“复核结束”：说清没结论，别让它停在没人管的状态。
  const finished = store.messages.find(message => message.meta?.kind === 'review_timeout')
  assert.equal(finished?.meta?.reason, 'invalid')
  assert.match(finished?.text ?? '', /没有拿到有效结论/)
})

test('a verdict the gate refused is re-asked in the gate’s own words, not as a coverage miss', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: { stage: 0, kind: 'result', diff: '', changedFiles: ['README.md'] },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const refusal = JSON.stringify({
    isError: true,
    content: [{ type: 'text', text: 'PASS 要写一条 diff 之外的风险；没有就写「无」。' }],
  })
  const refusedCall = {
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({
      decision: 'PASS',
      reason: '好了',
      coverage: [{ item: 'ship it', evidence: '读了 README.md' }],
    }),
    ok: false,
    output: refusal,
  }
  const turn = { reply: '**通过** 三个文件都在仓库根，跑通了。' }
  assert.equal(await review.consume({
    turn, memberId: 'verifier', turnId: 't1', room, calls: [refusedCall, proofCall],
  }), true)
  // 被拒的提交不算判定，也不能掉进“文字判定 → 覆盖表空 → 覆盖规则作废”的坑里；先把工具原话交回去。
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /diff 之外/)
  assert.match(sent.at(-1).prompt, /不要改用文字判定/)
  assert.equal(await review.consume({
    turn, memberId: 'verifier', turnId: 't2', room, calls: [refusedCall, proofCall],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /diff 之外/)
  // 两次重交都还被拒：这一轮作废。
  assert.equal(await review.consume({
    turn, memberId: 'verifier', turnId: 't3', room, calls: [refusedCall, proofCall],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  const system = store.messages.filter(message => message.kind === 'system')
  assert.ok(system.some(message => /被工具拒了/.test(message.text ?? '')))
  // 这一拍照样是“复核结束”，但原因写的是工具拒收，不是“没有逐条覆盖”。
  const finished = store.messages.find(message => message.meta?.kind === 'review_timeout')
  assert.equal(finished?.meta?.reason, 'invalid')
  assert.ok(!system.some(message => /没有逐条覆盖/.test(message.text ?? '')))
})

test('a PASS without reading a file or running a check is sent back once', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: { stage: 0, kind: 'result', diff: '', changedFiles: ['README.md'] },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const call = {
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({
      decision: 'PASS',
      reason: '好了',
      outsideDiff: '无',
      coverage: [{ item: 'ship it', evidence: '读了改动文件' }],
      falsify: [{ command: 'node --test' }],
    }),
  }
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /亲手验过/)
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't2',
    room,
    calls: [call, { name: 'Read', step: { target: 'README.md' } }],
  }), true)
  assert.equal(store.messages.find(message => message.kind === 'verdict')?.meta?.pass, true)
})

test('a changed existing test must be acknowledged, an added test does not', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  const diff = [
    'diff --git a/test/initials.test.js b/test/initials.test.js',
    'index 111..222 100644',
    '--- a/test/initials.test.js',
    '+++ b/test/initials.test.js',
    '@@ -1 +1 @@',
    '-expect(initials("a b")).toBe("AB")',
    '+expect(initials("a b")).not.toBe("")',
    'diff --git a/test/new.test.js b/test/new.test.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/test/new.test.js',
    '+expect(true).toBe(true)',
  ].join('\n')
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: {
      stage: 0,
      kind: 'result',
      diff,
      changedFiles: ['test/initials.test.js', 'test/new.test.js'],
    },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  // 只确认新增测试不够：既有断言被改写，必须逐条确认。
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({ decision: 'PASS', reason: '改好了', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], protectedFiles: ['test/new.test.js'] }), proofCall],
  }), true)
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
  assert.match(sent.at(-1).prompt, /test\/initials\.test\.js/)
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't2',
    room,
    calls: [call({ decision: 'PASS', reason: '改好了', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], protectedFiles: ['test/initials.test.js'], falsify: [{ command: 'node --test' }] }), proofCall],
  }), true)
  assert.equal(store.messages.find(message => message.kind === 'verdict')?.meta?.pass, true)
})

test('a preserve stage accepts a falsify that is green before and after', async () => {
  registerWorkspaceProvider('test-preserve-green', {
    capabilities: () => ({}),
    isolatedCopy: ({ ref }) => ({ path: `/base-${ref}` }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    verifiers: ['verifier'],
    workspace: { provider: 'test-preserve-green' },
    repoPath: '/repo',
    worktrees: { verifier: '/verifier' },
    stageBases: { 0: 'base1' },
  })
  room.stages[0].behavior = 'preserve'
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt, options = {}) => {
      sent.push({ memberId, prompt, options })
      return { messageId: `m${sent.length}` }
    },
  })
  await review.request(0)
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({ decision: 'PASS', reason: '行为没变', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '跑了旧的行为检查' }], falsify: [{ command: 'node --test' }] }), proofCall],
  }), true)
  assert.equal(store.messages.find(message => message.kind === 'verdict')?.meta?.pass, true)
})

test('a preserve stage records a falsify that is already red before the change', async () => {
  registerWorkspaceProvider('test-preserve-red', {
    capabilities: () => ({}),
    isolatedCopy: ({ ref }) => ({ path: `/base-${ref}` }),
    removeIsolatedCopy: () => {},
  })
  const room = makeRoom({
    verifiers: ['verifier'],
    workspace: { provider: 'test-preserve-red' },
    repoPath: '/repo',
    worktrees: { verifier: '/verifier' },
    stageBases: { 0: 'base1' },
  })
  room.stages[0].behavior = 'preserve'
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: ({ cwd }) => ({ status: String(cwd).startsWith('/base-') ? 'failed' : 'passed', exit: 1 }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt, options = {}) => {
      sent.push({ memberId, prompt, options })
      return { messageId: `m${sent.length}` }
    },
  })
  await review.request(0)
  const call = input => ({ name: 'mcp__lodge_gate__submit_verdict', input: JSON.stringify(input) })
  assert.equal(await review.consume({
    turn: { reply: '' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls: [call({ decision: 'PASS', reason: '行为没变', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '跑了旧的行为检查' }], falsify: [{ command: 'node --test' }] }), proofCall],
  }), true)
  // 改动前就红只说明这条命令不区分改前改后（也可能是命令写错了），不是平台该否掉的能力：
  // 判定照收，改前的退出码记进证据，让验收员和人自己看。
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict?.meta?.pass, true)
  assert.equal(verdict?.meta?.judgment?.falsifyRuns?.[0]?.run?.status, 'passed')
  assert.equal(verdict?.meta?.judgment?.falsifyRuns?.[0]?.base?.status, 'failed')
})

test('turn usage accumulates on the room and keeps unknown costs visible', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({
    turnId: 't-usage-1',
    reply: '',
    toolCalls: 0,
    usage: { input: 10, output: 5, costUsd: 0.002 },
  }, 'bot-exec')
  assert.equal(room.usage.costStatus, 'reported')
  assert.equal(room.usage.costMicroUsd, 2000)
  await turns.captureTurn({
    turnId: 't-usage-2',
    reply: '',
    toolCalls: 0,
    usage: { input: 1, output: 1, costUsd: null },
  }, 'bot-exec')
  assert.equal(room.usage.costStatus, 'partial')
  assert.equal(room.usage.costMicroUsd, 2000)
})

test('the same worker reply replayed under another turn id lands once', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  const reply = '实现和测试都已补完，npm test 全部通过；原实现没被动过。'
  await turns.captureTurn({ turnId: 't-first', reply, toolCalls: 0 }, 'bot-exec')
  await turns.captureTurn({ turnId: 't-replay', reply, toolCalls: 0 }, 'bot-exec')
  const evidence = store.messages.filter(message => (
    message.kind === 'evidence' && message.authorId === 'executor'
  ))
  assert.equal(evidence.length, 1)
})

test('result evidence comes from the acting member worktree, not the room integration path', async () => {
  registerWorkspaceProvider('test-result-path', {
    capabilities: () => ({ candidate: false, vcs: 'git' }),
    changes: async ({ path }) => ({
      files: path === '/worker' ? ['worker.txt'] : [],
      diff: '',
      status: '',
    }),
    head: ({ path }) => (path === '/worker' ? 'worker-head' : 'integration-head'),
  })
  const room = makeRoom({
    workspace: { provider: 'test-result-path' },
    repoPath: '/integration',
    worktrees: { executor: '/worker', verifier: '/verifier' },
  })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({ turnId: 't-member-path', reply: '做完了', toolCalls: 1 }, 'bot-exec')
  await new Promise(resolve => setTimeout(resolve, 50))
  const evidence = store.messages.find(message => message.kind === 'evidence' && message.meta?.kind === 'result')
  assert.ok(evidence)
  assert.equal(evidence.meta.repoPath, '/worker')
  assert.deepEqual(evidence.meta.files, ['worker.txt'])
})

test('a room without a workspace path never runs workspace commands in the process directory', async () => {
  let workspaceCalls = 0
  registerWorkspaceProvider('test-no-repo-path', {
    capabilities: () => ({ candidate: true, vcs: 'git', merge: true }),
    submit: () => { workspaceCalls += 1; return 'candidate' },
    head: () => { workspaceCalls += 1; return 'head' },
    changes: async () => { workspaceCalls += 1; return { files: [], diff: '', status: '' } },
  })
  const room = makeRoom({ workspace: { provider: 'test-no-repo-path' }, repoPath: null })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({ turnId: 't-no-repo', reply: '做完了', toolCalls: 1 }, 'bot-exec')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(workspaceCalls, 0)
  const evidence = store.messages.filter(message => message.kind === 'evidence' && message.meta?.kind === 'result')
  assert.equal(evidence.length, 1)
  assert.deepEqual(evidence[0].meta.files, [])
  assert.equal(evidence[0].meta.candidate, null)
})

test('a solo planner turn does not close the alignment before the crew exists', async () => {
  const room = makeRoom({
    stages: [
      { title: '目标对齐', kind: 'decision', spine: true, state: 'active' },
      { title: 'impl', kind: 'deliverable', state: 'pending' },
    ],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-planner', name: 'Planner' } },
    ],
    workers: [],
  })
  const store = fakeStore(room)
  const confirmed = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    confirmStage: (roomId, index) => { confirmed.push([roomId, index]) },
  })
  await turns.captureTurn({
    turnId: 't-align',
    reply: '目标清楚，对齐通过，没有待确认项。',
    toolCalls: 0,
  }, 'bot-planner')
  // 启动态没有执行官：对齐等规划师的 submit_plan，不靠一句话自动通过。
  assert.deepEqual(confirmed, [])
})

test('a captured turn writes a diagnostic with its outcome and usage', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  const diagnostics = []
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
    writeDiagnostic: (_room, turnId, payload) => diagnostics.push({ turnId, payload }),
  })
  await turns.captureTurn({
    turnId: 't-diagnostic',
    reply: '',
    toolCalls: 0,
    durationMs: 1200,
    usage: { input: 3, output: 2, costUsd: 0.001 },
  }, 'bot-exec')
  const last = diagnostics.at(-1)
  assert.equal(last.turnId, 't-diagnostic')
  assert.equal(last.payload.outcome, 'empty')
  assert.equal(last.payload.stage, 0)
  assert.equal(last.payload.durationMs, 1200)
  assert.equal(last.payload.usage.input, 3)
  assert.equal(last.payload.version, 2)
  assert.ok(last.payload.assessment.evidence.includes('耗时 1.2s'))
  assert.ok(last.payload.assessment.unknown.includes('回复为空'))
  assert.ok(last.payload.assessment.next.includes('检查续接或重开记录；必要时交给人'))
  assert.equal(room.stageDiagnostics[0].outcome, 'empty')
  assert.equal(room.stageDiagnostics[0].memberId, 'executor')
  assert.deepEqual(room.stageDiagnostics[0].assessment, last.payload.assessment)
})

test('a turn that started before the work stage began is not stage evidence', async () => {
  const room = makeRoom({
    stages: [
      { title: '目标对齐', kind: 'decision', spine: true, state: 'passed' },
      { title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it', activatedAt: 20_000 },
    ],
  })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  // 对齐阶段被 @ 醒的执行官在阶段确认后才结束；它说的是“等你确认”，不是第一步的产出。
  await turns.captureTurn({
    reply: '口径没问题，等你确认阶段后我就开始。',
    turnId: 't-align-echo',
    toolCalls: 0,
    at: 16_000,
    durationMs: 9_000,
  }, 'bot-exec')
  assert.ok(!store.messages.some(message => message.kind === 'evidence'))
  assert.ok(store.messages.some(message => /旧回合结果已忽略/.test(message.text ?? '')))
  assert.ok(store.events.some(event => event.type === 'turn.stale' && event.payload.reason === 'stage-started'))
})

test('a late turn from an older attempt is dropped before it touches evidence', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-late',
    roomId: 'room-1',
    stageIndex: 0,
    toMemberId: 'executor',
    reason: 'dispatch',
    brief: {},
    status: 'sent',
    sentAt: 10_000,
    context: {},
    flags: {},
  })
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({
    reply: '旧回合的结果',
    turnId: 't-old',
    toolCalls: 1,
    at: 12_000,
    durationMs: 9_000,
  }, 'bot-exec')
  assert.ok(!store.messages.some(message => message.kind === 'evidence'))
  assert.ok(store.messages.some(message => /旧回合结果已忽略/.test(message.text ?? '')))
  assert.ok(store.events.some(event => event.type === 'turn.stale'))
})

test('a late turn with usage on a finished round is ignored instead of throwing', async () => {
  const room = makeRoom({ workRound: { status: 'completed' } })
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await assert.doesNotReject(async () => turns.captureTurn({
    turnId: 't-late-usage',
    reply: '旧回合',
    toolCalls: 0,
    usage: { input: 10, output: 2 },
  }, 'bot-exec'))
  assert.equal(store.messages.some(message => message.kind === 'evidence' && message.turnId === 't-late-usage'), false)
})

test('a merge conflict is left for the human instead of being auto-reworked', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  room.mergeConflict = { stage: 0, files: ['shared.txt'] }
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
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
  await turns.captureTurn({ reply: '返工\n把 shared.txt 改成 alpha', turnId: 't-lead-3', toolCalls: 0 }, 'bot-plan')
  assert.equal(sent.length, 0)
  assert.equal(room.mergeConflict.stage, 0)
  assert.equal(room.lastPlannerDecision.kind, 'rework')
})

test('a parallel rework decided by the planner goes into the member private worktree', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { "id": "executor-2", "name": "执行官二号", "role": "worker", "roleKind": "executor", body: {"kind":"base","ref":"bot-exec2","name":"Exec2"} },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor', 'executor-2'],
    stages: [{
      title: 'impl',
      kind: 'deliverable',
      state: 'active',
      deliverable: 'ship it',
      assignees: ['executor', 'executor-2'],
    }],
  })
  const store = fakeStore(room)
  for (const id of ['executor', 'executor-2']) {
    store.writeAssignment({
      id: `as-${id}`, roomId: 'room-1', stageIndex: 0, toMemberId: id, reason: 'dispatch',
      brief: {}, status: 'reported', context: { parallel: true }, flags: {},
    })
  }
  store.appendMessage('room-1', {
    kind: 'verdict', authorId: 'verifier', text: 'REJECT', meta: rejectMeta(0),
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
  await turns.captureTurn({ reply: '返工\n两人各写自己的文件', turnId: 't-lead-parallel', toolCalls: 0 }, 'bot-plan')
  assert.equal(sent.length, 2)
  assert.deepEqual(sent.map(item => item.memberId).sort(), ['executor', 'executor-2'])
  assert.ok(sent.every(item => item.options.privateRoom === true))
})

test('turn state resets progress', async () => {
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

test('a single worker stage sends the prompt and posts the handoff projection', async () => {
  registerWorkspaceProvider('test-live-stage', {
    capabilities: () => ({ candidate: false, isolation: 'worktree' }),
    head: () => '',
  })
  const room = makeRoom({
    workspace: { provider: 'test-live-stage' },
    stages: [{
      title: 'impl',
      kind: 'deliverable',
      state: 'active',
      deliverable: 'ship it',
      clauseIds: ['run'],
      packages: [{ title: '实现', files: ['src/a.js'], clauseIds: ['run'] }],
    }],
    members: [
      { id: 'lead', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-lead', name: '规划师' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: '执行官' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: '验收员' } },
    ],
  })
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
    handoff: createHandoff({ store, roomId: 'room-1', sendToMember: async (memberId, prompt) => {
      prompts.push({ memberId, prompt })
      return { messageId: 'm1' }
    }, emit: () => {} }),
    updateTasks: () => {},
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].memberId, room.workers[0])
  assert.match(prompts[0].prompt, /这一步要交付：ship it/)
  assert.match(prompts[0].prompt, /阶段 1/)
  assert.match(prompts[0].prompt, /\[run\]/)
  const handoff = store.messages.find(message => message.meta?.kind === 'handoff')
  assert.match(handoff.text, /@执行官 第 1 步「impl」交给你/)
  const assignment = store.readAssignments('room-1')[0]
  assert.equal(assignment.status, 'sent')
  assert.deepEqual(assignment.context.clauseIds, ['run'])
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
    members: [
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { "id": "executor-2", "name": "执行官 2", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec2"} },
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

test('a parallel stage delivers into each worktree without waking the planner', async () => {
  registerWorkspaceProvider('test-live-parallel-spoken', {
    capabilities: () => ({ candidate: false, merge: true, isolation: 'worktree' }),
    head: () => 'base',
  })
  const room = makeRoom({
    workspace: { provider: 'test-live-parallel-spoken' },
    repoPath: '/repo',
    orchestration: 'parallel',
    workers: ['executor', 'executor-2'],
    members: [
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: 'Exec' } },
      { "id": "executor-2", "name": "执行官 2", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec2"} },
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
  assert.equal(plannerPrompts.length, 0)
  assert.deepEqual(prompts.map(item => item.memberId), ['executor', 'executor-2'])
  assert.match(prompts[0].prompt, /自己的 worktree/)
  assert.match(prompts[1].prompt, /自己的 worktree/)
  assert.equal(prompts[0].options.privateRoom, true)
  assert.equal(prompts[1].options.privateRoom, true)
})

test('a rework note reaches the worker even when the planner speaks without @', async () => {
  registerWorkspaceProvider('test-live-rework-note', {
    capabilities: () => ({ candidate: false, merge: true, isolation: 'worktree' }),
    head: () => 'base',
  })
  const room = makeRoom({
    workspace: { provider: 'test-live-rework-note' },
    repoPath: '/repo',
    stageBases: { 0: 'base' },
    workers: ['executor'],
    members: [
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: 'Exec' } },
    ],
  })
  const store = fakeStore(room)
  const prompts = []
  const plannerPrompts = []
  const sendToMember = async (memberId, prompt, options = {}) => {
    prompts.push({ memberId, prompt, options })
    return { messageId: `m-${memberId}` }
  }
  const starter = createStageStarter({
    store,
    roomId: 'room-1',
    emit: () => {},
    handoff: createHandoff({ store, roomId: 'room-1', sendToMember, emit: () => {} }),
    sendToMember,
    askPlanner: async prompt => {
      plannerPrompts.push(prompt)
      return '按用户的补充重做。'
    },
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0, { rework: true, note: '版本号 1.2.0' })
  assert.match(plannerPrompts[0], /用户补充（原文，必须保留）：版本号 1.2.0/)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].memberId, 'executor')
  assert.match(prompts[0].prompt, /版本号 1.2.0/)
})

test('retrying one branch revives the cancelled sibling on the same stage', async () => {
  registerWorkspaceProvider('test-live-parallel-revive', {
    capabilities: () => ({ candidate: false, merge: true, isolation: 'worktree' }),
    head: () => 'base',
  })
  const room = makeRoom({
    workspace: { provider: 'test-live-parallel-revive' },
    repoPath: '/repo',
    orchestration: 'parallel',
    stageBases: { 0: 'base' },
    workers: ['executor', 'executor-2'],
    members: [
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: 'Exec' } },
      { "id": "executor-2", "name": "执行官 2", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec2"} },
    ],
  })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-a', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'failed', context: { parallel: true }, flags: {},
  })
  store.writeAssignment({
    id: 'as-b', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor-2', reason: 'dispatch',
    brief: {}, status: 'cancelled', context: { parallel: true }, flags: {},
  })
  const prompts = []
  const sendToMember = async (memberId, prompt, options = {}) => {
    prompts.push({ memberId, prompt, options })
    return { messageId: `m-${memberId}` }
  }
  const starter = createStageStarter({
    store,
    roomId: 'room-1',
    emit: () => {},
    handoff: createHandoff({ store, roomId: 'room-1', sendToMember, emit: () => {} }),
    sendToMember,
    integrate: async () => {},
    enqueue: task => task(),
  })
  await starter.startStage(room, 0, { only: ['executor'], rework: true })
  assert.deepEqual(prompts.map(item => item.memberId).sort(), ['executor', 'executor-2'])
})

test('review request and verdict consumption update the round without crossing turns', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  assert.match(sent[0].prompt, /房间目标（整轮方向/)
  assert.match(sent[0].prompt, /硬要求/)
  assert.match(sent[0].prompt, /不要用更弱的标准/)
  const reply = [
    'PASS 符合目标',
    '```json',
    '{"reason":"符合目标","outsideDiff":"无","coverage":[{"item":"ship it","evidence":"读了改动文件"}],"falsify":[{"command":"node --test"}]}',
    '```',
  ].join('\n')
  assert.equal(await review.consume({ turn: { reply }, memberId: 'verifier', turnId: 't1', room, calls: [proofCall] }), true)
  assert.equal(review.isBusy(), false)
  assert.ok(store.messages.some(message => message.kind === 'verdict' && message.meta.pass === true))
  assert.ok(store.messages.some(message => /全部验收员通过/.test(message.text ?? '')))
})

test('a gate tool call supplies the verdict without parsing the reply', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: 'm2' }),
    updateTasks: () => {},
  })
  await review.request(0)
  const calls = [{
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({
      decision: 'REJECT',
      reason: '缺少日志',
      findings: [{ title: '没有运行记录', severity: 'major', check: 'npm test 会因为没有日志失败' }],
    }),
  }]
  assert.equal(await review.consume({
    turn: { reply: '已提交' },
    memberId: 'verifier',
    turnId: 't1',
    room,
    calls,
  }), true)
  const verdict = store.messages.find(message => message.kind === 'verdict')
  assert.equal(verdict.meta.pass, false)
  assert.equal(verdict.meta.judgment.source, 'gate')
  assert.equal(verdict.meta.reason, '缺少日志')
  assert.equal(verdict.text, '缺少日志')
  assert.equal(verdict.meta.judgment.findings[0].title, '没有运行记录')
})

test('critique review is blind to the execution conversation', async () => {
  const room = makeRoom({ verifiers: ['verifier'], orchestration: 'critique' })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  assert.match(sent[0].prompt, /对抗复核：只依据本轮结果/)
  assert.doesNotMatch(sent[0].prompt, /阶段进展/)
})

test('new evidence restarts an in-flight review and ignores the stale verdict', async () => {
  const room = makeRoom({ verifiers: ['verifier'] })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', diff: 'old' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
    meta: { stage: 0, kind: 'result', diff: 'new' },
  })
  await review.request(0)
  assert.equal(sent.length, 2)
  assert.equal(review.isBusy(), true)
  assert.equal(await review.consume({ turn: { reply: 'REJECT old' }, memberId: 'verifier', turnId: 't-old', room }), false)
  const pass = [
    'PASS new',
    '```json',
    '{"reason":"新结果符合","outsideDiff":"无","coverage":[{"item":"ship it","evidence":"读了新改动"}],"falsify":[{"command":"node --test"}]}',
    '```',
  ].join('\n')
  assert.equal(await review.consume({ turn: { reply: pass }, memberId: 'verifier', turnId: 't-new', room, calls: [proofCall] }), true)
  assert.equal(store.messages.some(message => message.kind === 'verdict' && message.meta.pass === true), true)
})

test('a verifier reject keeps the stage open and hands it back to the executor', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    leadMemberId: 'planner',
    members: [
      { "id": "planner", "role": "lead", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "executor", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec"} },
      { "id": "verifier", "role": "verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
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
  assert.equal(await review.consume({ turn: { reply: 'REJECT\n证据不足' }, memberId: 'verifier', turnId: 't1', room }), true)
  assert.equal(room.stages[0].state, 'active')
  const executor = sent.find(item => item.memberId === 'executor')
  assert.ok(executor)
  assert.match(executor.prompt, /证据不足/)
  assert.match(executor.prompt, /lodge-internal/)
  assert.equal(sent.some(item => item.memberId === 'planner'), false)
  assert.ok(store.messages.some(message => message.kind === 'rework' && message.meta?.stage === 0))
})


test('a review the quorum no longer needs is closed instead of left hanging', async () => {
  // 真房：两位验收员，一位否掉就够了；另一位还挂着的复核交接必须一起收口，
  // 否则整轮到最后一格永远“还有交接没有收口”。
  const room = makeRoom({
    verifiers: ['verifier', 'verifier-2'],
    leadMemberId: 'planner',
    members: [
      { id: 'planner', role: 'lead', roleKind: 'planner', body: { kind: 'base', name: 'Planner' } },
      { id: 'executor', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: 'Exec' } },
      { id: 'verifier', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', name: 'Verifier' } },
      { id: 'verifier-2', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', name: 'Verifier Two' } },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sendToMember = async (memberId, prompt) => ({ messageId: `m-${memberId}-${prompt.length}` })
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember,
    handoff: createHandoff({ store, roomId: 'room-1', sendToMember, emit: () => {} }),
    updateTasks: () => {},
  })
  await review.request(0)
  const openReviews = () => store.readAssignments('room-1')
    .filter(item => item.reason === 'review')
    .filter(item => !['passed', 'rejected', 'failed', 'cancelled'].includes(item.status))
  assert.equal(openReviews().length, 2)
  await review.consume({ turn: { reply: 'REJECT\n证据不足' }, memberId: 'verifier', turnId: 't1', room })
  // 退回会给执行官派一条新的返工交接；复核这一侧必须都收口。
  assert.deepEqual(openReviews(), [])
})

test('a verifier pass hands the summary to the planner', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    leadMemberId: 'planner',
    members: [
      { "id": "planner", "role": "lead", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "executor", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec"} },
      { "id": "verifier", "role": "verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const sendToMember = async (memberId, prompt) => {
    sent.push({ memberId, prompt })
    return { messageId: `m${sent.length}` }
  }
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember,
    handoff: createHandoff({ store, roomId: 'room-1', sendToMember, emit: () => {} }),
    updateTasks: () => {},
  })
  await review.request(0)
  const reply = [
    'PASS 达标',
    '```json',
    '{"reason":"达标","outsideDiff":"无","coverage":[{"item":"ship it","evidence":"读了改动文件"}],"falsify":[{"command":"node --test"}]}',
    '```',
  ].join('\n')
  assert.equal(await review.consume({ turn: { reply }, memberId: 'verifier', turnId: 't1', room, calls: [proofCall] }), true)
  await new Promise(resolve => setImmediate(resolve))
  const planner = sent.find(item => item.memberId === 'planner')
  assert.ok(planner)
  assert.match(planner.prompt, /验收通过/)
  assert.match(planner.prompt, /总结/)
  assert.equal(sent.some(item => item.memberId === 'executor'), false)
  const summary = store.readAssignments('room-1').find(item => item.reason === 'summary')
  assert.ok(summary, 'pass leaves a summary handoff to the planner')
  assert.equal(summary.toMemberId, 'planner')
  assert.equal(summary.status, 'sent')
  const projection = store.messages.find(message => (
    message.meta?.kind === 'handoff' && message.meta?.reason === 'summary'
  ))
  assert.ok(projection)
  assert.notEqual(projection.meta.show, false)
  assert.match(projection.text, /@\S+/)
})

test('auto delivery closes the round when the verifier passes', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    autoDeliver: true,
    leadMemberId: 'planner',
    members: [
      { "id": "planner", "role": "lead", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "executor", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec"} },
      { "id": "verifier", "role": "verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const advanced = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    advanceStage: async (_roomId, index, options) => {
      advanced.push({ index, options })
      return { ok: true }
    },
  })
  await review.request(0)
  const calls = [{
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: '达标', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], falsify: [{ command: 'node --test' }] }),
  }, proofCall]
  assert.equal(await review.consume({ turn: { reply: '已提交' }, memberId: 'verifier', turnId: 't1', room, calls }), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(advanced, [{ index: 0, options: { by: 'system', auto: true } }])
  assert.equal(sent.some(item => item.memberId === 'planner'), false)
})

test('a promise round delivers without the room-wide auto-deliver switch', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    // 房间本身不自动交付；这一轮是承诺开的，轮次自己带标记。
    workRound: { autoDeliver: true },
    leadMemberId: 'planner',
    members: [
      { "id": "planner", "role": "lead", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "executor", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec"} },
      { "id": "verifier", "role": "verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const advanced = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    advanceStage: async (_roomId, index, options) => {
      advanced.push({ index, options })
      return { ok: true }
    },
  })
  await review.request(0)
  const calls = [{
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: '达标', outsideDiff: '无', coverage: [{ item: 'ship it', evidence: '读了改动文件' }], falsify: [{ command: 'node --test' }] }),
  }, proofCall]
  assert.equal(await review.consume({ turn: { reply: '已提交' }, memberId: 'verifier', turnId: 't1', room, calls }), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(advanced, [{ index: 0, options: { by: 'system', auto: true } }])
})

test('a text verdict follows the same PASS rules instead of being waived', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    autoDeliver: true,
    leadMemberId: 'planner',
    members: [
      { "id": "planner", "role": "lead", "roleKind": "planner", body: {"kind":"base","name":"Planner"} },
      { "id": "executor", "role": "worker", "roleKind": "executor", body: {"kind":"base","name":"Exec"} },
      { "id": "verifier", "role": "verifier", "roleKind": "verifier", body: {"kind":"base","name":"Verifier"} },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const advanced = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt) => {
      sent.push({ memberId, prompt })
      return { messageId: `m${sent.length}` }
    },
    advanceStage: async (_roomId, index, options) => {
      advanced.push({ index, options })
      return { ok: true }
    },
  })
  await review.request(0)
  const reply = [
    'PASS 达标',
    '```json',
    '{"reason":"达标","outsideDiff":"无","coverage":[{"item":"ship it","evidence":"读了改动文件"}]}',
    '```',
  ].join('\n')
  assert.equal(await review.consume({ turn: { reply }, memberId: 'verifier', turnId: 't1', room, calls: [proofCall] }), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(advanced.length, 0)
  // 文本判定少了反例，和工具判定一样被退回重问，不因为换了入口就放行。
  assert.match(sent.at(-1).prompt, /反例/)
  const complete = [
    'PASS 达标',
    '```json',
    '{"reason":"达标","outsideDiff":"无","coverage":[{"item":"ship it","evidence":"读了改动文件"}],"falsify":[{"command":"node --test"}]}',
    '```',
  ].join('\n')
  assert.equal(await review.consume({ turn: { reply: complete }, memberId: 'verifier', turnId: 't2', room, calls: [proofCall] }), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(advanced, [{ index: 0, options: { by: 'system', auto: true } }])
})

test('an intermediate stage advances by itself instead of asking the planner to hand off', async () => {
  const room = makeRoom({
    verifiers: ['verifier'],
    stages: [
      { title: 'impl', kind: 'deliverable', state: 'active', deliverable: 'ship it' },
      { title: 'next', kind: 'deliverable', state: 'pending', deliverable: 'ship it' },
      { title: '验收与结论', kind: 'deliverable', state: 'pending' },
    ],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const sent = []
  const advanced = []
  const review = createReviewCoordinator({
    runCommand: () => ({ status: 'passed' }),
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async (memberId, prompt, options = {}) => {
      sent.push({ memberId, prompt, options })
      return { messageId: `m${sent.length}` }
    },
    advanceStage: async (_roomId, index) => {
      advanced.push(index)
      return { ok: true }
    },
  })
  await review.request(0)
  const reply = [
    'PASS 达标',
    '```json',
    '{"reason":"达标","outsideDiff":"无","coverage":[{"item":"ship it","evidence":"读了改动文件"}],"falsify":[{"command":"node --test"}]}',
    '```',
  ].join('\n')
  assert.equal(await review.consume({ turn: { reply }, memberId: 'verifier', turnId: 't1', room, calls: [proofCall] }), true)
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(advanced, [0])
  assert.equal(sent.some(item => item.memberId === 'planner'), false)
  assert.equal(sent.some(item => item.options?.intent === 'summary'), false)
})

test('the first activity cancels the member clock before evidence arrives', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  const cancelled = []
  store.cancelWork = id => cancelled.push(id)
  // 租约是一族队列项：取消靠 readWork 找到它们，不靠猜那一个 id。
  store.readWork = () => [{ id: 'assignment-lease:room-1:as-live', status: 'pending' }]
  store.writeAssignment({
    id: 'as-live', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'sent', context: {}, flags: {},
  })
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  turns.trackTool({
    kind: 'activity',
    authorRef: 'bot-exec',
    turnId: 't-long',
    ts: Date.now(),
    tool: { id: 'call-1' },
  })
  assert.ok(cancelled.includes('assignment-lease:room-1:as-live'))
})

test('a worker turn cancels the member clock before its 8-minute expiry', async () => {
  mock.timers.enable({ apis: ['Date'], now: 0 })
  try {
    const room = makeRoom({})
    const store = fakeStore(room)
    const enqueued = []
    const work = []
    const cancelled = []
    store.enqueueWork = item => {
      enqueued.push(item)
      const index = work.findIndex(current => current.id === item.id)
      if (index >= 0) work[index] = item
      else work.push(item)
      return item
    }
    store.cancelWork = id => cancelled.push(id)
    // 假队列要说自己的状态：真队列里的项都有 pending/leased/done。
    store.readWork = () => work.map(item => ({ status: 'pending', ...item }))
    store.writeAssignment({
      id: 'as-live', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
      brief: {}, status: 'sent', context: {}, flags: {},
    })
    const turns = createLiveTurns({
      store,
      roomId: 'room-1',
      emit: () => {},
      sendToMember: async () => ({ messageId: null }),
      commands: { run: async () => ({}) },
      files: { exists: () => false, read: () => Buffer.from('') },
    })
    // 模拟交接时落下的 8 分钟租约；7 分钟时成员交回证据，租约还没到期。
    store.enqueueWork({ id: 'assignment-lease:room-1:as-live', roomId: 'room-1', kind: 'assignment.lease', availableAt: 8 * 60_000 })
    enqueued.length = 0
    mock.timers.tick(7 * 60_000)
    await turns.captureTurn({ turnId: 't-live', reply: '实现完成，测试通过。', toolCalls: 0 }, 'bot-exec')
    assert.equal(enqueued.filter(item => item.id === 'assignment-lease:room-1:as-live').length, 0)
    assert.ok(cancelled.includes('assignment-lease:room-1:as-live'))
  } finally {
    mock.timers.reset()
  }
})

test('a worker turn without an assignment leaves an unattributed diagnostic', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({ turnId: 't-stray', reply: '随手说一句', toolCalls: 0 }, 'bot-exec')
  assert.ok(store.events.some(event => (
    event.type === 'turn.unattributed' &&
    event.payload.turnId === 't-stray' &&
    event.payload.memberId === 'executor'
  )))
})

test('a turn that lands on a closed assignment leaves a late-terminal diagnostic', async () => {
  const room = makeRoom({})
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-done', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'passed', turnId: 't-old', context: {}, flags: {},
  })
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: null }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.captureTurn({ turnId: 't-old', reply: '旧回合结果', toolCalls: 0 }, 'bot-exec')
  assert.ok(store.events.some(event => (
    event.type === 'turn.late_terminal' &&
    event.payload.turnId === 't-old' &&
    event.payload.assignmentId === 'as-done'
  )))
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

test('restart resumes a member that already acted instead of rerunning the task', async () => {
  const room = makeRoom({ live: true, busy: false })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-acted', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: { prompt: '从头做一遍' }, status: 'sent', sentAt: 100, context: {}, flags: {},
  })
  store.appendMessage('room-1', {
    kind: 'activity', authorId: 'executor', ts: 200, text: 'Bash',
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
  await turns.resume()
  assert.equal(sent.length, 1)
  assert.match(sent[0].prompt, /继续刚才/)
  assert.equal(sent[0].options.sendId, 'resume-as-acted')
})

test('a second zero-output restart stops instead of sending the task again', async () => {
  const room = makeRoom({ live: true, busy: false })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-quiet', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    roomType: 'studio',
    brief: { prompt: '从头做一遍' }, status: 'sent', sentAt: 100, context: {}, flags: { resumed: true },
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
  assert.equal(sent.length, 0)
  assert.equal(store.readAssignments('room-1').find(item => item.id === 'as-quiet').status, 'failed')
  assert.ok(store.messages.some(message => /仍然没有产出/.test(message.text ?? '')))
})


test('a verifier turn that dies expires the review instead of hanging the room', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    authorId: 'executor',
    meta: { stage: 0, kind: 'result', resultText: '', diff: '' },
  })
  const turns = createLiveTurns({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: async () => ({ messageId: 'm1' }),
    commands: { run: async () => ({}) },
    files: { exists: () => false, read: () => Buffer.from('') },
  })
  await turns.requestReview(0)
  assert.equal(turns.busyReview(), true)
  await turns.captureTurn({
    reply: '',
    turnId: 't-ver-dies',
    toolCalls: 2,
    stopReason: 'failed',
  }, 'bot-ver')
  // 重启后基座会重放同一个回合：seed 之后不能再记一次。
  turns.seed(store.messages)
  await turns.captureTurn({ reply: '', turnId: 't-ver-dies', toolCalls: 2, stopReason: 'failed' }, 'bot-ver')
  assert.equal(store.messages.filter(message => message.meta?.kind === 'turn_stopped').length, 1)
  // 复核当场作废并说清原因，不让人等满十分钟的超时。
  assert.equal(turns.busyReview(), false)
  assert.ok(store.messages.some(message => message.meta?.kind === 'review_timeout'))
  assert.ok(store.messages.some(message => /没有跑完/.test(message.text ?? '')))
  assert.ok(!store.messages.some(message => message.kind === 'verdict'))
})

test('a stopped turn is not a delivery: it fails the assignment and never reaches review', async () => {
  const room = makeRoom({
    leadMemberId: 'planner',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', ref: 'bot-plan', name: 'Planner' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', ref: 'bot-exec', name: 'Exec' } },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-ver', name: 'Verifier' } },
    ],
    workers: ['executor'],
  })
  const store = fakeStore(room)
  store.writeAssignment({
    id: 'as-1', roomId: 'room-1', stageIndex: 0, toMemberId: 'executor', reason: 'dispatch',
    brief: {}, status: 'sent', context: {}, flags: {}, sentAt: Date.now() - 60_000,
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
  await turns.captureTurn({
    reply: '已停下',
    turnId: 't-stop',
    toolCalls: 3,
    stopReason: 'stopped',
  }, 'bot-exec')
  // 被停下的回合不是结果：不写证据、不送给验收员。
  assert.ok(!store.messages.some(message => message.kind === 'evidence'))
  assert.ok(!sent.some(item => item.memberId === 'verifier'))
  assert.equal(store.readAssignment('as-1').status, 'failed')
  assert.ok(store.messages.some(message => (
    message.kind === 'system' && /没有跑完/.test(message.text ?? '')
  )))
})

test('a single-worker result is not captured and reviewed twice', async () => {
  registerWorkspaceProvider('test-integration-single', {
    capabilities: () => ({ merge: true, candidate: false }),
    integrate: () => ({ ok: true }),
    head: () => 'head-1',
    rangeChanges: async () => ({ diff: '', files: [], manifest: [] }),
  })
  const room = makeRoom({
    workspace: { provider: 'test-integration-single' },
    repoPath: '/repo',
    sourceRepo: '/src',
    branches: { executor: 'crew/room/executor' },
    worktrees: { executor: '/wt/executor' },
  })
  const store = fakeStore(room)
  store.appendMessage('room-1', {
    kind: 'evidence',
    meta: { stage: 0, kind: 'result', head: 'head-1', candidate: 'head-1' },
  })
  let reviews = 0
  const integrator = createStageIntegrator({
    store,
    roomId: 'room-1',
    emit: () => {},
    markProgress: () => {},
    requestReview: async () => { reviews += 1 },
    run: async () => ({ exit: 0 }),
  })
  await integrator.integrate({ stageIndex: 0, workers: ['executor'], base: 'head-0', turnId: 't1' })
  assert.equal(reviews, 0)
  assert.equal(store.messages.filter(message => message.kind === 'evidence' && message.meta?.kind === 'result').length, 1)
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
