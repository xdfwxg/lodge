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
    upsertMessage: message => { messages.push(message); return message },
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
  assert.equal(ctx.messages.at(-1).authorId, 'you')
  assert.equal(ctx.messages.at(-1).text, '@执行者 20 个字告诉我你能干啥')
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

test('chat turns cannot use any tool', () => {
  const ctx = setup()
  const room = { ...ctx.room(), chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({
    message: { authorRef: 'b-executor', card: { requestType: 'permission', requestId: 'p1', action: 'read', tool: 'Read' } },
  })
  assert.deepEqual(ctx.answered[0], { sessionRef: 'thread-1', requestId: 'p1', behavior: 'deny' })
})
