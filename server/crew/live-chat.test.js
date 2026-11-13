import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomChat } from './live-chat.js'
import { ROOM_CHAT_BULLETIN } from './room-chat.js'

const baseRoom = () => ({
  id: 'room-1',
  name: '样例房',
  goal: '把事做完',
  repoPath: '/tmp/room',
  leadSeat: 'planner',
  seatBots: { planner: 'b-planner', executor: 'b-executor', verifier: 'b-verifier' },
  seatNames: { planner: 'Plannerea1', executor: 'Executorea1', verifier: 'Verifierea1' },
  seatSpecs: [
    { id: 'planner', name: '规划师' },
    { id: 'executor', name: '执行者' },
    { id: 'verifier', name: '验收员' },
  ],
})

const setup = () => {
  let room = baseRoom()
  const messages = []
  const subscribed = []
  const sent = []
  const answered = []
  const engine = {
    createRoom: async input => {
      assert.equal(input.members.length, 3)
      assert.equal(input.bulletin, ROOM_CHAT_BULLETIN)
      return { id: 'chat-1', sessionRef: 'thread-1' }
    },
    history: async () => ({ messages: [] }),
    subscribe: input => {
      subscribed.push(input)
      return () => {}
    },
    sendTurn: async input => {
      sent.push(input)
      return { accepted: true, messageId: 'm-1' }
    },
    answerCard: async input => { answered.push(input); return { ok: true } },
  }
  const store = {
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const next = structuredClone(room)
      if (mutate(next) === null) return null
      room = next
      return room
    },
    appendMessage: (roomId, message) => { messages.push(message); return message },
    upsertMessage: message => {
      const index = messages.findIndex(item => item.id === message.id)
      if (index !== -1) messages[index] = message
      else messages.push(message)
      return message
    },
    readMessages: () => messages,
  }
  const chat = createRoomChat({
    store,
    engine,
    projector: { toStored: (roomId, message) => ({ ...message, id: 'stored-1', roomId }) },
    refresh: async () => {},
  })
  return { chat, engine, store, sent, subscribed, answered, messages, room: () => room }
}

test('a room gets one shared chat room with every seat', async () => {
  const ctx = setup()
  const room = await ctx.chat.ensure(ctx.room())
  assert.deepEqual(room.chatRoom, { id: 'chat-1', sessionRef: 'thread-1' })
})

test('chat goes to the shared room, with display names translated to handles', async () => {
  const ctx = setup()
  const room = await ctx.chat.ensure(ctx.room())
  await ctx.chat.send(room, '@执行者 20 个字告诉我你能干啥')
  assert.equal(ctx.sent[0].roomId, 'chat-1')
  assert.match(ctx.sent[0].text, /@Executorea1/)
  assert.match(ctx.sent[0].sendId, /^[A-Za-z0-9_-]{16,80}$/)
  assert.equal(ctx.messages.at(-1).authorId, 'you')
  assert.equal(ctx.messages.at(-1).text, '@执行者 20 个字告诉我你能干啥')
  assert.equal(ctx.messages.at(-1).id, `optimistic:${ctx.sent[0].sendId}`)
  assert.equal(ctx.messages.at(-1).meta.sendId, ctx.sent[0].sendId)
})

test('@所有人 maps to the base native @everyone', async () => {
  const ctx = setup()
  const room = await ctx.chat.ensure(ctx.room())
  await ctx.chat.send(room, '@所有人 继续')
  assert.match(ctx.sent[0].text, /@everyone 继续/)
})

test('chat events project into the room without touching stage turns', () => {
  const ctx = setup()
  const room = { ...ctx.room(), chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  assert.equal(ctx.subscribed.length, 1)
  ctx.subscribed[0].onEvent({ message: { id: 'm1', kind: 'text', role: 'bot', text: '在' } })
  assert.equal(ctx.messages.at(-1).id, 'stored-1')
})

test('a queued send reconciles its echo instead of showing the message twice', () => {
  const ctx = setup()
  const room = { ...ctx.room(), roomType: 'chat', chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  const echo = {
    id: 'echo-1',
    roomId: room.id,
    ts: Date.now(),
    kind: 'chat',
    authorId: 'you',
    text: '@规划师 你好',
    meta: { echo: true },
  }
  ctx.messages.push(echo)
  ctx.subscribed[0].onEvent({
    message: { id: 'base-1', kind: 'text', role: 'user', text: '@Plannerea1 你好', at: echo.ts + 400 },
  })
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].id, 'echo-1')
  assert.equal(ctx.messages[0].meta.baseId, 'base-1')
})

test('an auto-added mention is sent to the base but not shown in the room', async () => {
  const ctx = setup()
  const room = await ctx.chat.ensure(ctx.room())
  await ctx.chat.send(room, '@Plannerea1 结束了吗', { displayText: '结束了吗' })
  assert.equal(ctx.sent[0].text, '@Plannerea1 结束了吗')
  assert.equal(ctx.messages.at(-1).text, '结束了吗')
})

test('a sendId reconciles the echo even when the stored id changes', () => {
  const ctx = setup()
  const room = { ...ctx.room(), roomType: 'chat', chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  const echo = {
    id: 'optimistic:send-1234567890abcd',
    roomId: room.id,
    ts: Date.now(),
    kind: 'chat',
    authorId: 'you',
    text: '你好',
    meta: { echo: true, sendId: 'send-1234567890abcd' },
  }
  ctx.messages.push(echo)
  const message = { id: 'base-1', kind: 'text', role: 'user', sendId: 'send-1234567890abcd', text: '@Plannerea1 你好', at: echo.ts + 400 }
  ctx.subscribed[0].onEvent({ message })
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].id, echo.id)
  assert.equal(ctx.messages[0].text, '你好')
  assert.equal(ctx.messages[0].meta.baseId, 'base-1')
  ctx.subscribed[0].onEvent({ message })
  assert.equal(ctx.messages.length, 1)
})

test('chat turns allow read-only tools but never write or exec', () => {
  const ctx = setup()
  const room = { ...ctx.room(), roomType: 'chat', chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({
    message: { authorRef: 'b-executor', card: { requestType: 'permission', requestId: 'p1', action: 'read', tool: 'Read' } },
  })
  ctx.subscribed[0].onEvent({
    message: { authorRef: 'b-executor', card: { requestType: 'permission', requestId: 'p2', action: 'write', tool: 'Write' } },
  })
  assert.deepEqual(ctx.answered.map(item => item.behavior), ['allow', 'deny'])
})
