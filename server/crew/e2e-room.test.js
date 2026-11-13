import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { verifyEvidenceIntegrity } from './evidence-ledger.js'
import { createChatScheduler } from './live-chat-room.js'
import { createRealRoom } from './room-create.js'
import { createRoomCompleter } from './room-complete.js'
import { studioTransitionEvent, transitionStudio } from './room-state.js'
import { createServiceChat } from './service-chat.js'
import { createServiceStages } from './service-stages.js'
import { createStore } from './store.js'

const temp = prefix => mkdtempSync(join(tmpdir(), prefix))

// 固定脚本运行时：不启动 CLI，被 @ 的席位立刻回一条可预测的消息。
const scriptedEngine = store => {
  const history = []
  let seq = 0
  return {
    capabilities: () => ({ provisioning: true, skills: false, mcp: false }),
    instances: async () => [{ engine: 'fake', available: true }],
    createSeatBot: async ({ name }) => ({ id: `seat-${name}`, name, engine: 'fake', model: 'fake-model' }),
    createRoom: async ({ name }) => ({ id: `chat-${name}`, sessionRef: `thread-${name}` }),
    history: async () => ({ messages: [...history] }),
    rooms: async () => [],
    sendTurn: async ({ roomId, text }) => {
      const id = `u${++seq}`
      history.push({ id, role: 'user', kind: 'text', text, authorRef: null, at: Date.now() })
      const room = store.readRooms().find(item => item.chatRoom?.id === roomId)
      const summary = text.includes('请总结')
      const mention = /@([^\s，,。]+)/.exec(text)?.[1]
      const seat = (room?.members ?? []).find(item => (room.seatNames?.[item] ?? item) === mention)
        ?? room?.leadSeat
        ?? room?.members?.[0]
      const reply = summary
        ? '结论：按讨论继续推进。'
        : `${room?.seatNames?.[seat] ?? seat} 补充了一条观点。`
      if (seat !== undefined) {
        history.push({
          id: `a${++seq}`,
          role: 'agent',
          kind: 'text',
          text: reply,
          authorRef: room?.seatBots?.[seat] ?? null,
          at: Date.now(),
        })
        if (!summary) store.appendMessage(room.id, { kind: 'chat', authorId: seat, text: reply })
      }
      return { accepted: true, messageId: id }
    },
  }
}

const fakeLive = () => ({
  attach: async () => {},
  startStage: async () => {},
  startChat: async () => {},
  sendToSeat: async () => ({ messageId: null }),
  busyReview: () => false,
  reworkStage: async () => {},
  isAttached: () => true,
  cancel: async () => ({ cancelled: false }),
})

const moveStudio = (store, roomId) => (event, context = {}, actor = 'system', reason = '') => {
  const current = store.readRoom(roomId)
  const moved = transitionStudio(current.closure, event, context)
  assert.equal(moved.ok, true, moved.error)
  const updated = store.updateRoom(roomId, room => {
    room.closure = moved.state
    return { events: [studioTransitionEvent(moved, event, actor, context, reason)] }
  })
  assert.notEqual(updated, null)
  return moved.state
}

// 确定性场景：不启动真实 CLI，只驱动业务路径、账本、门禁和状态机。
test('deterministic room scenario reaches signed and accepted with a ledger', async () => {
  const previous = process.env.CREW_WORKSPACE_ROOT
  const root = temp('lodge-e2e-workspace-')
  process.env.CREW_WORKSPACE_ROOT = root
  const dataDir = temp('lodge-e2e-data-')
  const store = createStore({ dataDir })
  const engine = scriptedEngine(store)
  const ports = createCrewPorts()
  const live = fakeLive()
  try {
    const studio = await createRealRoom({
      store,
      engine,
      live,
      emit: () => {},
      dispatchPayload: () => null,
      body: {
        goal: '确定性端到端：写 E2E.md',
        roomType: 'studio',
        verify: 'test',
        plan: {
          done: ['E2E.md 存在'],
          stages: [{ title: '写 E2E.md', kind: 'deliverable', acceptance: 'test -f E2E.md' }],
        },
        seats: [
          { role: 'lead', name: '规划' },
          { role: 'worker', name: '执行' },
          { role: 'verifier', name: '验收' },
        ],
      },
      ports,
    })
    assert.equal(studio.ok, true)
    const room = studio.body.room
    assert.equal(room.closure, 'planned')

    const move = moveStudio(store, room.id)
    move('start_execute', {}, 'planner', '计划确认')

    const firstText = '验收命令 test -f E2E.md 已执行，退出码 0。'
    const firstEvidence = store.appendMessage(room.id, {
      kind: 'evidence',
      authorId: 'system',
      text: firstText,
      meta: { kind: 'command', stage: 1, command: 'test -f E2E.md', exit: 0, diff: 'D', files: ['E2E.md'] },
    })
    move('submit_evidence', { exitCode: 0 }, 'executor', '提交第一轮证据')
    store.appendMessage(room.id, {
      kind: 'verdict',
      authorId: 'verifier',
      text: 'REJECT\n没有覆盖返工后的断言。',
      meta: { pass: false, stage: 1, evidenceId: firstEvidence.id, roleKind: 'verifier', mode: 'agent', reason: '缺少断言' },
    })
    move('verdict_reject', {}, 'verifier', 'Verifier 打回')

    const completeRoom = createRoomCompleter({ store, emit: () => {}, roomFiles: ports.roomFiles, workspace: ports.workspace }).completeRoom
    const stages = createServiceStages({
      store,
      live,
      emit: () => {},
      dispatchPayload: () => null,
      completeRoom,
      roomFiles: ports.roomFiles,
    })
    const rework = stages.rework(store.readRoom(room.id), { stage: 1, note: '补一个断言再提交' })
    assert.equal(rework.ok, true)

    const secondEvidence = store.appendMessage(room.id, {
      kind: 'evidence',
      authorId: 'system',
      text: '返工后重跑 test -f E2E.md，退出码 0。',
      meta: { kind: 'command', stage: 1, command: 'test -f E2E.md', exit: 0, diff: 'D', files: ['E2E.md'] },
    })
    move('submit_evidence', { exitCode: 0 }, 'executor', '返工后重新提交')
    store.appendMessage(room.id, {
      kind: 'verdict',
      authorId: 'verifier',
      text: 'PASS\n返工后的证据已覆盖断言。',
      meta: { pass: true, stage: 1, evidenceId: secondEvidence.id, roleKind: 'verifier', mode: 'agent' },
    })

    const ledger = store.readEvidence(room.id)
    assert.equal(ledger.length, 2)
    assert.equal(ledger[0].id, firstEvidence.id)
    assert.equal(ledger[1].id, secondEvidence.id)
    assert.match(ledger[0].digest, /^[a-f0-9]{64}$/)
    const integrity = verifyEvidenceIntegrity(ledger)
    assert.equal(integrity.ok, true)
    assert.equal(integrity.verified, 2)

    const first = stages.accept(store.readRoom(room.id), { stage: 1 })
    assert.equal(first.ok, true)
    assert.equal(store.readRoom(room.id).closure, 'verifying')
    const final = stages.accept(store.readRoom(room.id), { stage: 2 })
    assert.equal(final.ok, true)
    assert.equal(store.readRoom(room.id).closure, 'signed')
    assert.equal(store.readRoom(room.id).state, 'complete')

    const closureSequence = store.readEvents(room.id)
      .filter(event => event.type === 'closure.transition')
      .map(event => event.payload.event)
    assert.deepEqual(closureSequence, [
      'start_execute',
      'submit_evidence',
      'verdict_reject',
      'submit_evidence',
      'await_sign',
      'sign',
    ])

    const chatRoom = await createRealRoom({
      store,
      engine,
      live,
      emit: () => {},
      dispatchPayload: () => null,
      body: {
        goal: '确定性端到端：聊天室',
        roomType: 'chat',
        seats: [
          { role: 'lead', name: '主持' },
          { role: 'worker', name: '甲' },
          { role: 'worker', name: '乙' },
          { role: 'worker', name: '丙' },
        ],
      },
      ports,
    })
    assert.equal(chatRoom.ok, true)
    const chatId = chatRoom.body.room.id
    const scheduler = createChatScheduler({
      store,
      engine,
      roomId: chatId,
      random: () => 0,
      waitMs: 500,
      pollMs: 1,
    })
    const round = await scheduler.start(chatRoom.body.room)
    assert.equal(round.started, true)
    assert.equal(round.error, undefined)
    assert.equal(store.readRoom(chatId).chat.phase, 'awaiting_decision')
    assert.equal(store.readRoom(chatId).chat.turns, 6)
    assert.equal(store.readMessages(chatId).filter(message => message.kind === 'chat').length, 6)
    const conclusion = store.readMessages(chatId).find(message => message.kind === 'chat_conclusion')
    assert.equal(conclusion.meta.turns, 6)
    assert.equal(conclusion.meta.fallback, false)

    const chat = createServiceChat({ store, live, emit: () => {}, dispatchPayload: () => null })
    const accepted = chat.accept(store.readRoom(chatId))
    assert.equal(accepted.ok, true)
    assert.equal(store.readRoom(chatId).state, 'complete')
    assert.equal(store.readRoom(chatId).chat.phase, 'accepted')

    const chatSequence = store.readEvents(chatId)
      .filter(event => event.type === 'chat.transition')
      .map(event => event.payload.event)
    assert.deepEqual(chatSequence, ['summarize', 'conclude', 'accept'])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})
