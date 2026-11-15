import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_TURNS_PER_ROUND, turnLimitOf as chatTurnLimitOf } from './room-types/chat.js'
import { createChatScheduler, pickChatSpeaker } from './rooms/chat/scheduler.js'

test('a chat round defaults to six speakers and accepts a room limit', () => {
  assert.equal(CHAT_TURNS_PER_ROUND, 6)
  assert.equal(chatTurnLimitOf({}), 6)
  assert.equal(chatTurnLimitOf({ chat: { turnLimit: 4 } }), 4)
  assert.equal(chatTurnLimitOf({ chat: { turnLimit: 99 } }), 6)
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
    chat: {
      round: 1,
      phase: 'discussing',
      turns: 0,
      conclusionId: null,
      accepted: false,
      running: false,
      speaker: '',
      note: '',
    },
    members: ['a', 'b'],
    seatBots: { a: 'A', b: 'B' },
    seatNames: { a: 'A', b: 'B' },
    seatSpecs: [
      { id: 'a', name: '甲', personality: 'assertive' },
      { id: 'b', name: '乙', personality: 'cheerful' },
    ],
    chatHost: { memberRef: 'H', name: 'LodgeHost', displayName: 'Lodge 主持' },
    chatRoom: { id: 'chat', sessionRef: 'thread' },
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
      const ref = text.includes('LodgeHost') ? 'H' : ['A', 'B'].find(item => text.includes(`@${item}`))
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
  return { store, engine, room: () => current, messages, history }
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
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.room().chat.phase, 'awaiting_decision')
  const opening = ctx.messages.find(message => message.kind === 'chat' && message.meta?.opening === true)
  assert.match(opening.text, /本轮围绕【讨论状态提示】展开讨论/)
  assert.doesNotMatch(opening.text, /欢迎大家踊跃发言/)
  assert.doesNotMatch(opening.text, /先发言/)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat' && message.authorId !== 'lodge').length, 6)
  const conclusion = ctx.messages.find(message => message.kind === 'chat_conclusion')
  assert.equal(conclusion.meta.round, 1)
  assert.equal(conclusion.meta.turns, 6)
  assert.equal(conclusion.meta.fallback, false)
  assert.equal(ctx.room().chat.conclusionId, conclusion.id)
  const prompts = ctx.history.filter(message => message.role === 'user').map(message => message.text)
  assert.equal(prompts.some(text => text.includes('已有讨论')), false)
  assert.equal(prompts.some(text => text.includes('本轮表达：【开朗活跃】')), true)
  assert.equal(prompts.some(text => text.includes('本轮表达：【果敢善辩】')), true)
  assert.equal(Math.max(...prompts.map(text => text.length)) < 400, true)

  ctx.store.updateRoom('room-chat', state => {
    state.chat = { ...state.chat, round: 2, running: false, turns: 0, phase: 'awaiting_decision' }
    return { events: [] }
  })
  const next = await scheduler.start(ctx.room(), { note: '补充失败态' })
  assert.equal(next.started, true)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat' && message.authorId !== 'lodge').length, 12)
  const conclusions = ctx.messages.filter(message => message.kind === 'chat_conclusion')
  assert.equal(conclusions.length, 2)
  assert.equal(conclusions.at(-1).meta.round, 2)
})

test('a chat room can run fewer turns than the default', async () => {
  const ctx = setup()
  ctx.store.updateRoom('room-chat', state => {
    state.chat = { ...state.chat, turnLimit: 2 }
    return { events: [] }
  })
  const scheduler = createChatScheduler({
    store: ctx.store,
    engine: ctx.engine,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room())
  assert.equal(result.turns, 2)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat' && message.authorId !== 'lodge').length, 2)
  const conclusion = ctx.messages.find(message => message.kind === 'chat_conclusion')
  assert.equal(conclusion.meta.turns, 2)
  assert.equal(conclusion.meta.turnLimit, 2)
})
