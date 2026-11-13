import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createRealRoom } from './room-create.js'
import { createRoomCompleter } from './room-complete.js'
import { createServiceChat } from './service-chat.js'
import { createServiceStages } from './service-stages.js'
import { createStore } from './store.js'

const temp = prefix => mkdtempSync(join(tmpdir(), prefix))

const fakeEngine = () => ({
  capabilities: () => ({ provisioning: true, skills: false, mcp: false }),
  createSeatBot: async ({ name }) => ({ id: `seat-${name}`, name, engine: 'fake', model: 'fake-model' }),
  createRoom: async ({ name }) => ({ id: `room-${name}`, sessionRef: `thread-${name}` }),
})

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

// 确定性场景：不启动真实 CLI，只驱动业务路径、账本、门禁和状态机。
test('deterministic room scenario reaches signed and accepted with a ledger', async () => {
  const previous = process.env.CREW_WORKSPACE_ROOT
  const root = temp('lodge-e2e-workspace-')
  process.env.CREW_WORKSPACE_ROOT = root
  const dataDir = temp('lodge-e2e-data-')
  const store = createStore({ dataDir })
  const ports = createCrewPorts()
  const live = fakeLive()
  try {
    const studio = await createRealRoom({
      store,
      engine: fakeEngine(),
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

    store.updateRoom(room.id, current => {
      current.closure = 'executing'
      return { events: [{ type: 'closure.transition', payload: { from: 'planned', to: 'executing', event: 'start_execute', actor: 'planner' } }] }
    })
    const command = store.appendMessage(room.id, {
      kind: 'evidence',
      authorId: 'system',
      text: '验收命令 test -f E2E.md 已执行，退出码 0。',
      meta: { kind: 'command', stage: 1, command: 'test -f E2E.md', exit: 0, diff: 'D', files: ['E2E.md'] },
    })
    const ledger = store.readEvidence(room.id)
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0].id, command.id)
    assert.match(ledger[0].digest, /^[a-f0-9]{64}$/)

    store.appendMessage(room.id, {
      kind: 'verdict',
      authorId: 'verifier',
      text: 'PASS\n文件存在，命令退出码 0。',
      meta: { pass: true, stage: 1, evidenceId: ledger[0].id, roleKind: 'verifier', mode: 'bot' },
    })
    const completeRoom = createRoomCompleter({ store, emit: () => {}, roomFiles: ports.roomFiles, workspace: ports.workspace }).completeRoom
    const stages = createServiceStages({
      store,
      live,
      emit: () => {},
      dispatchPayload: () => null,
      completeRoom,
      roomFiles: ports.roomFiles,
    })
    const first = stages.accept(store.readRoom(room.id), { stage: 1 })
    assert.equal(first.ok, true)
    assert.equal(store.readRoom(room.id).closure, 'verifying')
    const final = stages.accept(store.readRoom(room.id), { stage: 2 })
    assert.equal(final.ok, true)
    assert.equal(store.readRoom(room.id).closure, 'signed')
    assert.equal(store.readRoom(room.id).state, 'complete')

    const chatRoom = await createRealRoom({
      store,
      engine: fakeEngine(),
      live,
      emit: () => {},
      dispatchPayload: () => null,
      body: { goal: '确定性端到端：聊天室', roomType: 'chat', chatTurnLimit: 2 },
      ports,
    })
    assert.equal(chatRoom.ok, true)
    const chatId = chatRoom.body.room.id
    store.updateRoom(chatId, current => {
      current.chat = { ...current.chat, phase: 'awaiting_decision', running: false, conclusionId: 'conclusion-1' }
      return { events: [] }
    })
    store.appendMessage(chatId, {
      kind: 'chat_conclusion',
      authorId: 'lead',
      text: '结论：可以开工。',
      meta: { round: 1, turns: 2, host: 'lead' },
    })
    const chat = createServiceChat({ store, live, emit: () => {}, dispatchPayload: () => null })
    const accepted = chat.accept(store.readRoom(chatId))
    assert.equal(accepted.ok, true)
    assert.equal(store.readRoom(chatId).state, 'complete')
    assert.equal(store.readRoom(chatId).chat.phase, 'accepted')

    const transitionTypes = store.readEvents(room.id).map(event => event.type)
    assert.ok(transitionTypes.includes('closure.transition'))
    assert.ok(store.readEvents(chatId).some(event => event.type === 'chat.transition'))
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})
