import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoundActions } from './round.js'

const setup = () => {
  const messages = []
  const sent = []
  let round = {
    id: 'round-1',
    pendingDecision: {
      id: 'd1',
      status: 'open',
      stage: 0,
      question: '走哪条路？',
      options: [
        { id: 'keep-local', title: '保留本地', effect: '不覆盖刚改的内容' },
        { id: 'take-remote', title: '用远端', effect: '当前页回到远端版本' },
      ],
      recommended: 'keep-local',
      answer: null,
    },
  }
  let room = {
    id: 'room-1',
    state: 'active',
    goal: '保存',
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner' },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor' },
      { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier' },
    ],
    workRound: round,
    pendingDecision: round.pendingDecision,
  }
  const store = {
    readRoom: () => room,
    readMessages: () => messages,
    updateRound: (_id, mutate) => {
      const current = structuredClone(round)
      const change = mutate(current)
      if (change === null || change === undefined || change === false) return null
      round = current
      room = { ...room, pendingDecision: round.pendingDecision, workRound: round }
      return room
    },
    updateRoom: () => room,
    readAssignments: () => [],
    readAssignment: () => null,
    appendMessage: (_id, message) => { messages.push(message); return message },
    appendEvent: () => {},
  }
  const resumed = []
  const actions = createRoundActions({
    store,
    live: {
      sendToMember: async (...args) => { sent.push(args); return { messageId: 'm1' } },
      send: async (...args) => { sent.push(args); return { messageId: 'm2' } },
      isAttached: () => true,
      attach: async () => {},
      busyReview: () => false,
    },
    resumeRound: ({ room: target }) => {
      resumed.push(target.id)
      return { ok: true, body: { room: target } }
    },
    emit: () => {},
    appendMessage: store.appendMessage,
    updateRound: store.updateRound,
    readRoom: store.readRoom,
    readMessages: store.readMessages,
  })
  return { actions, store, room: () => room, round: () => round, messages, sent, resumed }
}

test('picking a path records the answer and sends it to the planner', async () => {
  const ctx = setup()
  const result = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'take-remote' }) })
  assert.equal(result.ok, true)
  assert.equal(ctx.round().pendingDecision.status, 'answered')
  assert.equal(ctx.round().pendingDecision.answer.optionId, 'take-remote')
  assert.match(ctx.messages[0].text, /选：用远端/)
  assert.match(ctx.sent[0][2], /用户对「走哪条路？」选了：用远端/)
})

test('cancelling closes the card without waking the planner', async () => {
  const ctx = setup()
  const result = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'cancel' }) })
  assert.equal(result.ok, true)
  assert.equal(ctx.round().pendingDecision.status, 'cancelled')
  assert.equal(ctx.sent.length, 0)
  assert.match(ctx.messages[0].text, /先不做/)
  // 取消后留一句看得见的状态，用户知道房间停在哪、下一步能说什么。
  assert.match(ctx.messages[1].text, /先停在这里/)
  assert.equal(ctx.messages[1].meta.show, true)
})

test('a direction the user writes themselves goes to the planner as it is', async () => {
  const ctx = setup()
  const text = '两条都不选，先用拼音，中文保留兜底'
  const result = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'other', text }) })
  assert.equal(result.ok, true)
  assert.equal(ctx.round().pendingDecision.status, 'answered')
  assert.equal(ctx.round().pendingDecision.answer.optionId, 'other')
  assert.equal(ctx.messages[0].text, text)
  assert.match(ctx.sent[0][2], /没有选卡上的路，自己写的是：两条都不选/)
})

test('an empty written direction is rejected', async () => {
  const ctx = setup()
  const result = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'other', text: '   ' }) })
  assert.equal(result.ok, false)
  assert.equal(ctx.round().pendingDecision.status, 'open')
})

test('an old decision id or a closed card cannot be answered twice', async () => {
  const ctx = setup()
  const stale = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'old', optionId: 'keep-local' }) })
  assert.equal(stale.ok, false)
  await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'keep-local' }) })
  const again = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'take-remote' }) })
  assert.equal(again.ok, false)
})

test('a message in a stopped room continues that round instead of starting a new one', async () => {
  const ctx = setup()
  const current = ctx.room()
  current.workRound.status = 'stopped'
  current.state = 'idle'
  current.live = true
  current.stages = [{ title: '实现', state: 'active' }]
  const goalBefore = current.goal
  const result = await ctx.actions.messages({ roomId: 'room-1', room: current, readBody: async () => ({ text: '继续' }) })
  assert.equal(result.ok, true)
  // 机器先把这一轮接回来，再把这句话交给规划师；目标没有被覆盖。
  assert.deepEqual(ctx.resumed, ['room-1'])
  assert.equal(ctx.room().goal, goalBefore)
  assert.equal(ctx.sent.length, 1)
  // 工作室的群不靠 @ 唤醒；接回来的这一轮直接把话送给规划师。
  assert.equal(ctx.sent[0][1], 'planner')
  assert.equal(ctx.sent[0][2], '继续')
})

test('a studio message goes straight to the planner instead of a muted group mention', async () => {
  const ctx = setup()
  Object.assign(ctx.room(), { roomType: 'studio', live: true })
  const result = await ctx.actions.messages({ roomId: 'room-1', room: ctx.room(), readBody: async () => ({ text: '用 Pillow' }) })
  assert.equal(result.ok, true)
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.sent[0][1], 'planner')
  assert.match(ctx.sent[0][2], /用 Pillow/)
})

test('a stopped studio round is resumed and the user message goes to the planner', async () => {
  const ctx = setup()
  Object.assign(ctx.room(), { roomType: 'studio', live: true })
  ctx.room().workRound.status = 'stopped'
  const result = await ctx.actions.messages({ roomId: 'room-1', room: ctx.room(), readBody: async () => ({ text: '用 Pillow' }) })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.resumed, ['room-1'])
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.sent[0][1], 'planner')
  assert.match(ctx.sent[0][2], /用 Pillow/)
})
