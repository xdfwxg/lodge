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
  const actions = createRoundActions({
    store,
    live: {
      sendToMember: async (...args) => { sent.push(args); return { messageId: 'm1' } },
    },
    emit: () => {},
    appendMessage: store.appendMessage,
    updateRound: store.updateRound,
    readRoom: store.readRoom,
    readMessages: store.readMessages,
  })
  return { actions, store, room: () => room, round: () => round, messages, sent }
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
})

test('an old decision id or a closed card cannot be answered twice', async () => {
  const ctx = setup()
  const stale = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'old', optionId: 'keep-local' }) })
  assert.equal(stale.ok, false)
  await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'keep-local' }) })
  const again = await ctx.actions.decision({ room: ctx.room(), readBody: async () => ({ decisionId: 'd1', optionId: 'take-remote' }) })
  assert.equal(again.ok, false)
})
