import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_TURNS_PER_ROUND, createChatScheduler, pickChatSpeaker } from './live-chat-room.js'

test('a chat round is fixed at six speakers', () => {
  assert.equal(CHAT_TURNS_PER_ROUND, 6)
})

test('unspoken speakers are covered before anyone repeats', () => {
  const seat = pickChatSpeaker({
    speakers: ['a', 'b', 'c'],
    counts: new Map([['a', 1], ['b', 1], ['c', 0]]),
    perSeat: 2,
    last: 'b',
    random: () => 0,
  })
  assert.equal(seat, 'c')
})

test('the same speaker is not picked twice in a row when another is eligible', () => {
  const seat = pickChatSpeaker({
    speakers: ['a', 'b'],
    counts: new Map([['a', 1], ['b', 1]]),
    perSeat: 3,
    last: 'a',
    random: () => 0,
  })
  assert.equal(seat, 'b')
})

const setup = () => {
  let current = {
    id: 'room-chat',
    kind: 'room',
    name: '聊天室',
    goal: '讨论状态提示',
    state: 'active',
    roomType: 'chat',
    chatRound: 1,
    chatTurns: 0,
    chatRunning: false,
    chatPhase: '',
    chatSpeaker: '',
    leadSeat: 'lead',
    members: ['lead', 'a', 'b'],
    seatBots: { lead: 'L', a: 'A', b: 'B' },
    seatNames: { lead: 'Lead', a: 'A', b: 'B' },
    seatSpecs: [
      { id: 'lead', name: '主持人' },
      { id: 'a', name: '甲' },
      { id: 'b', name: '乙' },
    ],
    chatRoom: { id: 'chat', sessionRef: 'thread' },
    stages: [
      { title: '聊天讨论', kind: 'decision', state: 'active', readOnly: true },
      { title: '结论', kind: 'decision', state: 'pending', dependsOn: [0], readOnly: true },
    ],
  }
  const messages = []
  const history = []
  const store = {
    readRoom: () => current,
    readMessages: () => messages,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m${messages.length + 1}`, seq: messages.length + 1, ...message }
      messages.push(stored)
      return stored
    },
  }
  const engine = {
    history: async () => ({ messages: [...history] }),
    rooms: async () => [{ id: 'chat', working: false }],
    sendTurn: async ({ text }) => {
      const ref = ['L', 'A', 'B'].find(item => text.includes(`@${item}`))
      const summary = text.includes('请总结')
      const id = `u${history.length + 1}`
      history.push({ id, role: 'user', kind: 'text', text, authorRef: null, at: Date.now() })
      history.push({
        id: `a${history.length + 1}`,
        role: 'agent',
        kind: 'text',
        text: summary ? '这是总结。' : '这是发言。',
        authorRef: ref,
        at: Date.now(),
      })
      if (!summary) {
        const authorId = Object.entries(current.seatBots).find(([, value]) => value === ref)?.[0]
        store.appendMessage(current.id, { kind: 'chat', authorId, text: '这是发言。' })
      }
      return { accepted: true, messageId: id }
    },
  }
  return { store, engine, room: () => current, messages }
}

test('a chat round runs six speakers, then the host summarizes', async () => {
  const ctx = setup()
  const scheduler = createChatScheduler({
    store: ctx.store,
    engine: ctx.engine,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room())
  assert.equal(result.started, true)
  assert.equal(ctx.room().chatRunning, false)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat').length, 6)
  const conclusion = ctx.messages.find(message => message.kind === 'chat_conclusion')
  assert.equal(conclusion.meta.round, 1)
  assert.equal(conclusion.meta.turns, 6)
  assert.equal(conclusion.meta.fallback, false)
  assert.deepEqual(ctx.room().stages.map(stage => stage.state), ['passed', 'active'])

  ctx.store.updateRoom('room-chat', state => {
    state.chatRound = 2
    state.chatRunning = false
    state.chatTurns = 0
    return { events: [] }
  })
  const next = await scheduler.start(ctx.room(), { note: '补充失败态' })
  assert.equal(next.started, true)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat').length, 12)
  const conclusions = ctx.messages.filter(message => message.kind === 'chat_conclusion')
  assert.equal(conclusions.length, 2)
  assert.equal(conclusions.at(-1).meta.round, 2)
})
