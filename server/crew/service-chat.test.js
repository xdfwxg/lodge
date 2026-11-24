import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceChat } from './rooms/chat/service.js'
import { MENTION_ALL } from '../../shared/mentions.js'

const setup = () => {
  let current = {
    id: 'room-chat',
    kind: 'room',
    roomType: 'chat',
    state: 'active',
    live: true,
    usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
    chat: {
      round: 1,
      phase: 'concluded',
      turns: 6,
      conclusionId: 'c-1',
      running: false,
      speaker: '',
      note: '',
    },
  }
  const messages = []
  const calls = []
  const sent = []
  const reviews = []
  let reviewReply = 'PASS\n没有超出讨论记录。'
  let intent = { action: 'reply', reply: '我在。', speakers: [] }
  let readIntent = async () => intent
  const store = {
    readMessages: () => messages,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m-${messages.length + 1}`, seq: messages.length + 1, ...message }
      messages.push(stored)
      return stored
    },
  }
  const chat = createServiceChat({
    store,
    live: {
      isAttached: () => true,
      hostIntent: async () => readIntent(),
      continueChat: async (room, note, options = {}) => {
        calls.push({
          roomId: room.id,
          note,
          ...(Array.isArray(options.speakerIds) ? { speakers: options.speakerIds } : {}),
          ...(options.resume === true ? { resume: true } : {}),
        })
      },
      send: async (roomId, text, options = {}) => {
        sent.push({ roomId, text, ...options })
      },
      reviewChatConclusion: async (room, options = {}) => {
        reviews.push({ roomId: room.id, ...options })
        return { text: reviewReply }
      },
    },
    emit: () => {},
  })
  return {
    chat,
    room: () => current,
    messages,
    calls,
    sent,
    reviews,
    setIntent: next => { intent = next },
    setHostIntent: next => { readIntent = next },
    setReviewReply: next => { reviewReply = next },
  }
}

test('a concluded chat starts another round without asking for confirmation', async () => {
  const ctx = setup()
  const result = ctx.chat.continue(ctx.room(), { note: '还缺反方观点' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().chat.round, 2)
  assert.equal(ctx.room().chat.running, true)
  assert.equal(ctx.room().chat.phase, 'discussing')
  assert.equal(ctx.room().chat.conclusionId, null)
  assert.equal(ctx.messages.at(-1).kind, 'chat_rework')
  assert.equal(ctx.messages.at(-1).text, '还缺反方观点')
  assert.deepEqual(ctx.calls, [{ roomId: 'room-chat', note: '还缺反方观点' }])
})

test('a chat round is refused when the room budget is used up', () => {
  const ctx = setup()
  ctx.room().usage = { costMicroUsd: 500, budgetMicroUsd: 500, costStatus: 'reported' }
  const result = ctx.chat.continue(ctx.room(), { note: '再来一轮' })
  assert.equal(result.ok, false)
  assert.match(result.error, /额度用完了/)
  assert.deepEqual(ctx.calls, [])
})

test('a host reply answers without reopening the room', async () => {
  const ctx = setup()
  ctx.setIntent({ action: 'reply', reply: '我在，先说你的判断。', speakers: [] })
  const result = await ctx.chat.input(ctx.room(), { note: '你怎么看？' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().chat.phase, 'concluded')
  assert.equal(ctx.messages.at(-1).kind, 'chat')
  assert.equal(ctx.messages.at(-1).authorId, 'lodge')
  assert.equal(ctx.messages.at(-1).text, '我在，先说你的判断。')
  assert.deepEqual(ctx.calls, [])
})

test('a host round reopens with the speakers it named', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  ctx.setIntent({ action: 'round', reply: '我请三位说说。', speakers: ['a', 'b', 'c'] })
  const result = await ctx.chat.input(ctx.room(), { note: '大家怎么看？' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().state, 'active')
  assert.equal(ctx.room().chat.round, 2)
  assert.deepEqual(ctx.calls, [{ roomId: 'room-chat', note: '大家怎么看？', speakers: ['a', 'b', 'c'] }])
  assert.equal(ctx.messages.at(-1).authorId, 'lodge')
  assert.equal(ctx.messages.at(-1).text, '我请三位说说。')
})

test('the host pending state is visible while it reads the input', async () => {
  const ctx = setup()
  let release
  const intent = new Promise(resolve => { release = resolve })
  ctx.setHostIntent(async () => intent)
  const pending = ctx.chat.input(ctx.room(), { note: '你在吗？' })
  await Promise.resolve()
  assert.equal(ctx.room().chat.hostThinking, true)
  release({ action: 'reply', reply: '在。', speakers: [] })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(ctx.room().chat.hostThinking, false)
})

test('an interrupted discussion resumes the same round from its spoken turns', () => {
  const ctx = setup()
  ctx.room().chat = { ...ctx.room().chat, phase: 'discussing', running: false, interrupted: true, turns: 2, conclusionId: null }
  const result = ctx.chat.restart(ctx.room(), {})
  assert.equal(result.ok, true)
  assert.equal(ctx.room().chat.running, true)
  assert.equal(ctx.room().chat.interrupted, false)
  assert.equal(ctx.room().chat.turns, 2)
  assert.equal(ctx.room().chat.phase, 'discussing')
  assert.equal(ctx.messages.at(-1).text, '接着这一轮继续，已经说过的话都还在。')
  assert.deepEqual(ctx.calls, [{ roomId: 'room-chat', note: '', resume: true }])
})

test('restart refuses when the room has already concluded', () => {
  const ctx = setup()
  const result = ctx.chat.restart(ctx.room(), {})
  assert.equal(result.ok, false)
  assert.match(result.error, /没有可恢复/)
})

test('a message without a mention goes to the host', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲' }]
  ctx.setIntent({ action: 'reply', reply: '我在。', speakers: [] })
  const result = await ctx.chat.handleMessage(ctx.room(), { text: '你怎么看？', mentions: [] })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().chat.phase, 'concluded')
  assert.deepEqual(ctx.messages.map(message => [message.authorId, message.text]), [
    ['you', '你怎么看？'],
    ['lodge', '我在。'],
  ])
  assert.deepEqual(ctx.sent, [])
})

test('@everyone opens a round when the room is open', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]
  const result = await ctx.chat.handleMessage(ctx.room(), { text: '大家聊聊', mentions: [MENTION_ALL] })
  assert.equal(result.ok, true)
  assert.equal(ctx.messages[0].authorId, 'you')
  assert.equal(ctx.messages[0].text, '大家聊聊')
  assert.equal(ctx.messages.filter(message => message.authorId === 'you').length, 1)
  assert.deepEqual(ctx.calls, [{ roomId: 'room-chat', note: '大家聊聊', speakers: ['a', 'b'] }])
})

test('a host-opened round does not write the user message twice', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]
  ctx.setIntent({ action: 'round', reply: '那就开一轮。', speakers: ['a', 'b'] })
  const result = await ctx.chat.handleMessage(ctx.room(), { text: '直接让大家说说', mentions: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.messages.map(message => [message.authorId, message.text]), [
    ['you', '直接让大家说说'],
    ['lodge', '那就开一轮。'],
  ])
})

test('@everyone waits while a round is already running', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲' }]
  ctx.room().chat = { ...ctx.room().chat, phase: 'discussing' }
  const result = await ctx.chat.handleMessage(ctx.room(), { text: '大家聊聊', mentions: [MENTION_ALL] })
  assert.equal(result.ok, false)
  assert.match(result.error, /等结论/)
})

test('a named member gets the message directly in open chat', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲' }]
  const result = await ctx.chat.handleMessage(ctx.room(), { text: '甲，你看呢', mentions: ['a'] })
  assert.equal(result.ok, true)
  assert.equal(ctx.messages[0].authorId, 'you')
  assert.equal(ctx.messages[0].text, '甲，你看呢')
  assert.deepEqual(ctx.sent, [{
    roomId: 'room-chat',
    text: '甲，你看呢',
    mentions: ['a'],
    meta: { direct: ['甲'] },
  }])
})

test('a named member waits while a round is running', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲' }]
  ctx.room().chat = { ...ctx.room().chat, phase: 'discussing' }
  const result = await ctx.chat.handleMessage(ctx.room(), { text: '甲，你看呢', mentions: ['a'] })
  assert.equal(result.ok, false)
  assert.match(result.error, /等结束再点名/)
  assert.deepEqual(ctx.sent, [])
})

test('a chat conclusion can be reviewed by a critic before handing off', async () => {
  const ctx = setup()
  ctx.room().members = [
    { id: 'a', name: '甲', stance: 'proposer', body: { engine: 'claude' } },
    { id: 'b', name: '乙', stance: 'critic', body: { engine: 'pi' } },
  ]
  ctx.messages.push({ id: 'sp-1', kind: 'chat', authorId: 'a', text: '先说一句' })
  ctx.messages.push({ id: 'c-1', kind: 'chat_conclusion', authorId: 'lodge', text: '结论' })
  const result = await ctx.chat.reviewConclusion(ctx.room(), { conclusionId: 'c-1' })
  assert.equal(result.ok, true)
  assert.equal(result.body.pass, true)
  assert.equal(ctx.reviews[0].reviewerId, 'b')
  assert.equal(ctx.messages.at(-1).meta.kind, 'conclusion_review')
  assert.equal(ctx.messages.at(-1).meta.pass, true)
})

test('a reviewer can flag a conclusion that goes beyond the discussion', async () => {
  const ctx = setup()
  ctx.room().members = [{ id: 'a', name: '甲', stance: 'critic', body: { engine: 'claude' } }]
  ctx.messages.push({ id: 'c-1', kind: 'chat_conclusion', authorId: 'lodge', text: '结论' })
  ctx.setReviewReply('CONCERN\n“下周上线”没有在讨论里出现过。')
  const result = await ctx.chat.reviewConclusion(ctx.room(), { conclusionId: 'c-1' })
  assert.equal(result.ok, true)
  assert.equal(result.body.pass, false)
  assert.match(result.body.detail, /下周上线/)
  assert.equal(ctx.messages.at(-1).meta.pass, false)
})
