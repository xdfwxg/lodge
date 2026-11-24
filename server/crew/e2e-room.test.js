import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { buildDelivery } from './rooms/studio/delivery.js'
import { createChatScheduler } from './rooms/chat/scheduler.js'
import { createChatTransport } from './rooms/chat/transport.js'
import { createRealRoom } from './rooms/create/create.js'
import { createRoomCompleter } from './rooms/studio/complete.js'
import { startRound } from './rounds/start.js'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { createStore } from './store.js'

const temp = prefix => mkdtempSync(join(tmpdir(), prefix))

// 固定脚本运行时：不启动 CLI，被 @ 的席位立刻回一条可预测的消息。
const scriptedEngine = (store, { approvalReview = true, authenticated } = {}) => {
  const history = []
  let seq = 0
  return {
    capabilities: () => ({ provisioning: true, mentions: true, mcp: false }),
    instances: async () => [{ id: 'fake', engine: 'fake', available: true, ...(authenticated === undefined ? {} : { authenticated }), capabilities: { approvalReview } }],
    createMemberBot: async ({ name }) => ({ id: `member-${name}`, name, engine: 'fake', model: 'fake-model' }),
    setBotSkills: async (botId, skills) => ({ assignedSkills: skills }),
    createRoom: async ({ name }) => ({ id: `chat-${name}`, sessionRef: `thread-${name}` }),
    deleteRoom: async () => {},
    deleteMemberBot: async () => {},
    history: async () => ({ messages: [...history] }),
    rooms: async () => [],
    sendTurn: async ({ roomId, text }) => {
      const id = `u${++seq}`
      history.push({ id, role: 'user', kind: 'text', text, authorRef: null, at: Date.now() })
      const room = store.readRooms().find(item => item.chatRoom?.id === roomId)
      const summary = text.includes('请总结')
      const pick = text.includes('下一位从这些成员里选')
      const order = text.includes('按顺序列出这轮要发言的成员')
      const mention = /@([^\s，,。]+)/.exec(text)?.[1]
      const hostTurn = (summary || pick || order) && room?.chatHost?.name === mention
      const member = (room?.members ?? []).find(item => item.name === mention || item.body?.name === mention)
        ?? (room?.members ?? []).find(item => item.id === room.leadMemberId)
        ?? room?.members?.[0]
      const authorRef = hostTurn ? room.chatHost.memberRef : member?.body?.ref ?? null
      const picked = pick ? text.match(/选：([^。]+)。/)?.[1]?.split('、')[0] ?? member?.name : ''
      const names = (room?.members ?? []).map(item => item.name)
      const limit = Number(text.match(/不超过 (\d+) 次/)?.[1] ?? 6)
      const reply = summary
        ? '结论：按讨论继续推进。'
        : order
          ? Array.from({ length: limit }, (_, index) => names[index % names.length] ?? '成员').join('、')
          : pick ? picked : `${member?.name ?? member?.id ?? '成员'} 补充了一条观点。`
      if (hostTurn || member !== undefined) {
        history.push({
          id: `a${++seq}`,
          role: 'agent',
          kind: 'text',
          text: reply,
          authorRef,
          at: Date.now(),
        })
        if (!summary && !pick && !order) store.appendMessage(room.id, { kind: 'chat', authorId: member.id, text: reply })
      }
      return { accepted: true, messageId: id }
    },
  }
}

const fakeLive = () => ({
  attach: async () => {},
  startStage: async () => {},
  startChat: async () => {},
  sendToMember: async () => ({ messageId: null }),
  busyReview: () => false,
  reworkStage: async () => {},
  isAttached: () => true,
  cancel: async () => ({ cancelled: false }),
})

// 确定性场景：不启动真实 CLI，只驱动业务路径、账本、门禁和阶段状态。
test('deterministic room scenario completes the round and accepts it', async () => {
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
    assert.equal(room.stages[1].state, 'active')

    const firstText = '验收命令 test -f E2E.md 已执行，退出码 0。'
    const firstEvidence = store.appendMessage(room.id, {
      kind: 'evidence',
      authorId: 'system',
      text: firstText,
      meta: { kind: 'command', stage: 1, command: 'test -f E2E.md', exit: 0, diff: 'D', files: ['E2E.md'] },
    })
    store.appendMessage(room.id, {
      kind: 'verdict',
      authorId: 'verifier',
      text: 'REJECT\n没有覆盖返工后的断言。',
      meta: { pass: false, stage: 1, evidenceId: firstEvidence.id, roleKind: 'verifier', mode: 'agent', reason: '缺少断言' },
    })

    const completeRoom = createRoomCompleter({ store, emit: () => {}, roomFiles: ports.roomFiles, workspace: ports.workspace }).completeRoom
    const stages = createServiceStages({
      store,
      live,
      emit: () => {},
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
    store.appendMessage(room.id, {
      kind: 'verdict',
      authorId: 'verifier',
      text: 'PASS\n返工后的证据已覆盖断言。',
      meta: { pass: true, stage: 1, evidenceId: secondEvidence.id, roleKind: 'verifier', mode: 'agent' },
    })

    const evidence = store.readEvidence(room.id)
    assert.equal(evidence.length, 2)
    assert.equal(evidence[0].id, firstEvidence.id)
    assert.equal(evidence[1].id, secondEvidence.id)

    // 验收通过后系统会给规划师留一条“收尾”交接；它只是请人说两句，不能把交付卡住。
    const lead = store.readRoom(room.id).members.find(member => member.role === 'lead' || member.roleKind === 'planner')
    store.writeAssignment({
      id: 'as-summary', roomId: room.id, stageIndex: 1, fromMemberId: 'verifier', toMemberId: lead.id,
      reason: 'summary', status: 'sent', createdAt: Date.now(), sentAt: Date.now(), context: {}, flags: {},
    })

    const first = stages.accept(store.readRoom(room.id), { stage: 1 })
    assert.equal(store.readAssignment('as-summary').status, 'passed')
    assert.equal(first.ok, true)
    // 最后一个工作阶段通过就收尾：这一轮完成，工作室回到空闲；交付卡跟着这一轮。
    assert.equal(store.readRoom(room.id).stages[1].state, 'passed')
    assert.equal(store.readRoom(room.id).state, 'idle')
    assert.equal(store.readRoom(room.id).workRound?.status, 'completed')

    const delivery = buildDelivery(store.readRoom(room.id), store.readMessages(room.id))
    assert.equal(delivery.evidenceCount, 2)

    const firstRound = store.readRoom(room.id).workRound
    const next = { body: { goal: '再补一行说明', verify: 'manual' } }
    const started = await startRound({
      store,
      live,
      emit: () => {},
      room: store.readRoom(room.id),
      body: next.body,
      roomFiles: ports.roomFiles,
      startMessage: {
        kind: 'chat',
        authorId: 'you',
        text: '再补一行说明',
      },
    })
    assert.equal(started.ok, true, started.error)
    const second = store.readRoom(room.id)
    assert.equal(second.state, 'active')
    assert.equal(second.workRound.status, 'active')
    assert.notEqual(second.workRound.id, firstRound.id)
    assert.equal(store.readWorkRounds(room.id).length, 2)
    assert.equal(store.readMessages(room.id).some(message => message.kind === 'verdict'), false)
    const secondMessages = store.readMessages(room.id)
    const requestAt = secondMessages.findIndex(message => message.authorId === 'you' && message.text === '再补一行说明')
    const handoffAt = secondMessages.findIndex(message => message.meta?.kind === 'handoff')
    assert.ok(requestAt >= 0)
    assert.ok(handoffAt >= 0)
    assert.ok(requestAt < handoffAt, 'the human request should precede the handoff')

    const passedStages = store.readEvents(room.id)
      .filter(event => event.type === 'stage.passed')
      .map(event => event.payload.stage)
    assert.deepEqual(passedStages, [1, 2])

    const chatRoom = await createRealRoom({
      store,
      engine,
      live,
      emit: () => {},
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
    for (const member of chatRoom.body.room.members) {
      assert.deepEqual(member.permissions, { read: true, exec: false, write: false })
      assert.deepEqual(member.toolSurface, ['read'])
    }
    const chatId = chatRoom.body.room.id
    const sendToMember = (memberId, text) => {
      const room = store.readRoom(chatId)
      const name = memberId === 'host' ? room.chatHost.name : (room.members ?? []).find(item => item.id === memberId)?.name ?? memberId
      return engine.sendTurn({ roomId: room.chatRoom.id, text: `@${name} ${text}` })
    }
    const scheduler = createChatScheduler({
      store,
      transport: createChatTransport({ engine, store, roomId: chatId }),
      sendToMember,
      roomId: chatId,
      random: () => 0,
      waitMs: 500,
      pollMs: 1,
    })
    const round = await scheduler.start(chatRoom.body.room)
    assert.equal(round.started, true)
    assert.equal(round.error, undefined)
    assert.equal(store.readRoom(chatId).chat.phase, 'concluded')
    assert.equal(store.readRoom(chatId).chat.turns, 6)
    const chatHost = chatRoom.body.room.leadMemberId
    assert.equal(store.readMessages(chatId).filter(message => message.kind === 'chat' && message.meta?.opening !== true && message.authorId !== chatHost).length, 6)
    assert.equal(store.readMessages(chatId).some(message => message.meta?.opening === true), true)
    const conclusion = store.readMessages(chatId).find(message => message.kind === 'chat_conclusion')
    assert.equal(conclusion.meta.turns, 6)
    assert.equal(conclusion.meta.fallback, false)
    assert.equal(conclusion.meta.handoffBrief.topic, store.readRoom(chatId).goal)

    assert.equal(store.readRoom(chatId).state, 'active')

    const chatSequence = store.readEvents(chatId)
      .filter(event => event.type === 'chat.transition')
      .map(event => event.payload.event)
    assert.deepEqual(chatSequence, ['summarize', 'conclude'])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})

test('a body that is not logged in never starts the room', async () => {
  const previous = process.env.CREW_WORKSPACE_ROOT
  const root = temp('lodge-login-workspace-')
  process.env.CREW_WORKSPACE_ROOT = root
  const dataDir = temp('lodge-login-data-')
  const store = createStore({ dataDir })
  const engine = scriptedEngine(store, { authenticated: false })
  const ports = createCrewPorts()
  try {
    const result = await createRealRoom({
      store,
      engine,
      live: fakeLive(),
      emit: () => {},
      body: {
        goal: '写一个文件',
        roomType: 'studio',
        verify: 'test',
        plan: {
          done: ['文件存在'],
          stages: [{ title: '写文件', kind: 'deliverable', acceptance: 'test -f A.md' }],
        },
      },
      ports,
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /成员还没准备好/)
    assert.match(result.error, /登录失效/)
    assert.deepEqual(store.readRooms(), [])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})

test('a delivery room refuses exec members whose model cannot ask', async () => {
  const previous = process.env.CREW_WORKSPACE_ROOT
  const root = temp('lodge-block-workspace-')
  process.env.CREW_WORKSPACE_ROOT = root
  const dataDir = temp('lodge-block-data-')
  const store = createStore({ dataDir })
  const engine = scriptedEngine(store, { approvalReview: false })
  const ports = createCrewPorts()
  try {
    const result = await createRealRoom({
      store,
      engine,
      live: fakeLive(),
      emit: () => {},
      body: {
        goal: '写一个文件',
        roomType: 'studio',
        verify: 'test',
        plan: {
          done: ['文件存在'],
          stages: [{ title: '写文件', kind: 'deliverable', acceptance: 'test -f A.md' }],
        },
      },
      ports,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'invalid')
    assert.match(result.error, /不会逐次确认外部动作/)
    assert.match(result.error, /聊天室/)
    assert.deepEqual(store.readRooms(), [])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})
