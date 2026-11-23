import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomChat } from './kernel/live/bus.js'
import { ROOM_CHAT_BULLETIN } from './room-chat.js'
import { dropStaleStreams } from './rooms/chat/projection.js'
import { normalizeTestRoom } from './testing/room.js'

const baseRoom = () => normalizeTestRoom({
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

const setup = (capabilities = { streaming: true, mentions: true, provisioning: true, approvals: true }, projector = null) => {
  let room = baseRoom()
  const messages = []
  const subscribed = []
  const sent = []
  const answered = []
  const permissions = []
  const engine = {
    capabilities: () => capabilities,
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
    projector: projector ?? { toStored: (roomId, message) => ({ ...message, id: 'stored-1', roomId }) },
    refresh: async () => {},
    onPermission: (entry, member, message) => permissions.push({ member, message }),
  })
  return { chat, engine, store, sent, subscribed, answered, permissions, messages, room: () => room }
}

test('a room gets one shared chat room with every member', async () => {
  const ctx = setup()
  const room = await ctx.chat.ensure(ctx.room())
  assert.deepEqual(room.chatRoom, { id: 'chat-1', sessionRef: 'thread-1' })
})

test('chat goes to the shared room, with display names translated to base names', async () => {
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

test('a turn preamble stays out of the room until the body arrives', () => {
  const projector = {
    toStored: (roomId, message) => ({
      id: message.id, roomId, kind: 'chat', authorId: 'worker-2', text: message.text,
      ...(message.meta === undefined ? {} : { meta: message.meta }),
    }),
  }
  const ctx = setup(undefined, projector)
  const room = { ...ctx.room(), chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ message: { id: 'm0', kind: 'chat', text: '我先看下。', meta: { turnId: 't1', turnFinal: false } } })
  assert.deepEqual(ctx.messages, [])
  ctx.subscribed[0].onEvent({ message: { id: 'm1', kind: 'chat', text: '正文。', meta: { turnId: 't1', turnFinal: true } } })
  assert.deepEqual(ctx.messages.map(message => message.id), ['m1'])
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

test('a streamed final reply maps base names to member names', () => {
  const ctx = setup()
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '@Executorea1 ', turnId: 't1' })
  assert.equal(ctx.messages.at(-1).text, '@执行者 ')
  assert.equal(ctx.messages.at(-1).meta.streaming, true)
  ctx.subscribed[0].onEvent({
    message: { id: 'm1', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '@Executorea1 你好', at: Date.now() },
  })
  assert.equal(ctx.messages.at(-1).text, '@执行者 你好')
  assert.equal(ctx.messages.at(-1).meta.streaming, false)
  assert.equal(ctx.messages.at(-1).meta.final, true)
})

test('a user prompt never finalizes a member stream', () => {
  const ctx = setup(undefined, { toStored: () => null })
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '正文', turnId: 't1' })
  ctx.subscribed[0].onEvent({
    message: { id: 'p1', kind: 'text', role: 'user', text: '@执行官 聊天室话题：… [[lodge-internal]]', at: 2 },
  })
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].text, '正文')
  assert.equal(ctx.messages[0].meta.streaming, true)
})

test('a turn opening line never finalizes the streaming reply', () => {
  const projector = {
    toStored: (roomId, message) => ({
      id: message.id,
      roomId,
      kind: 'chat',
      authorId: 'executor',
      text: message.text,
      ...(typeof message.turnId === 'string'
        ? {
          meta: {
            turnId: message.turnId,
            ...(typeof message.turnFinal === 'boolean' ? { turnFinal: message.turnFinal } : {}),
          },
        }
        : {}),
    }),
  }
  const ctx = setup(undefined, projector)
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '正文', turnId: 't1' })
  // 过场先到：不该把正在流的正文结算成自己。
  ctx.subscribed[0].onEvent({
    message: { id: 'm0', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '我先看下。', turnId: 't1', turnFinal: false, at: 2 },
  })
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].text, '正文')
  assert.equal(ctx.messages[0].meta.streaming, true)
  // 正文到齐才收口。
  ctx.subscribed[0].onEvent({
    message: { id: 'm1', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '正文', turnId: 't1', turnFinal: true, at: 3 },
  })
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].text, '正文')
  assert.equal(ctx.messages[0].meta.streaming, false)
})

test('a member that speaks twice keeps both turns', () => {
  const ctx = setup()
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  const say = (turnId, text, id) => {
    ctx.subscribed[0].onEvent({ type: 'delta', delta: text, turnId })
    ctx.subscribed[0].onEvent({
      message: { id, kind: 'text', role: 'agent', authorRef: 'b-executor', text, at: Date.now() },
    })
  }
  say('t1', '第一轮', 'm1')
  say('t2', '第二轮', 'm2')
  assert.deepEqual(ctx.messages.map(message => message.text), ['第一轮', '第二轮'])
})

test('syncing base history keeps a streamed final reply once', async () => {
  const ctx = setup()
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  base.chatRoom = { id: 'chat-1', sessionRef: 'thread-1' }
  const room = { ...base }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '你好', turnId: 't1' })
  const final = { id: 'm1', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '你好', at: Date.now() }
  ctx.subscribed[0].onEvent({ message: final })
  assert.equal(ctx.messages.length, 1)
  ctx.engine.history = async () => ({ messages: [final] })
  ctx.subscribed[0].onState({ connected: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].meta.baseId, 'm1')
})

test('a digest after a streamed reply does not repeat the same words', () => {
  const ctx = setup()
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '你好', turnId: 't1' })
  ctx.subscribed[0].onEvent({
    message: { id: 'm1', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '你好', at: Date.now() },
  })
  assert.equal(ctx.messages.length, 1)
  ctx.subscribed[0].onEvent({
    message: {
      id: 'd1',
      kind: 'turn',
      role: 'agent',
      authorRef: 'b-executor',
      text: '你好',
      turn: { reply: '你好', turnId: 't1' },
      at: Date.now(),
    },
  })
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].text, '你好')
})

test('a truncated digest after a streamed reply is not a second message', () => {
  const ctx = setup()
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '你好，世界', turnId: 't1' })
  ctx.subscribed[0].onEvent({
    message: { id: 'm1', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '你好，世界', at: Date.now() },
  })
  ctx.subscribed[0].onEvent({
    message: {
      id: 'd1',
      kind: 'turn',
      role: 'agent',
      authorRef: 'b-executor',
      text: '你好',
      turn: { reply: '你好', turnId: 't1' },
      at: Date.now(),
    },
  })
  assert.equal(ctx.messages.length, 1)
})

test('a late duplicate stream is hidden behind the final words', () => {
  const ctx = setup()
  const base = ctx.room()
  base.roomType = 'chat'
  base.chat = { speaker: 'executor' }
  const room = { ...base, chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '你好', turnId: 't1' })
  ctx.subscribed[0].onEvent({
    message: { id: 'm1', kind: 'text', role: 'agent', authorRef: 'b-executor', text: '你好', at: Date.now() },
  })
  ctx.subscribed[0].onEvent({ type: 'delta', delta: '你好', turnId: 't2' })
  assert.equal(ctx.messages.length, 2)
  ctx.subscribed[0].onEvent({
    message: {
      id: 'd1',
      kind: 'turn',
      role: 'agent',
      authorRef: 'b-executor',
      text: '你好',
      turn: { reply: '你好', turnId: 't2' },
      at: Date.now(),
    },
  })
  assert.equal(dropStaleStreams(ctx.messages).length, 1)
})

test('permission cards are handed to the room strategy', () => {
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
  assert.deepEqual(ctx.permissions.map(item => item.message.card.action), ['read', 'write'])
  assert.equal(ctx.answered.length, 0)
})

test('permission cards are ignored when the runtime has no approvals', () => {
  const ctx = setup({ streaming: true, mentions: true, provisioning: true, approvals: false })
  const room = { ...ctx.room(), roomType: 'chat', chatRoom: { id: 'chat-1', sessionRef: 'thread-1' } }
  const entry = { roomId: room.id }
  ctx.chat.subscribe(entry, room)
  ctx.subscribed[0].onEvent({
    message: { authorRef: 'b-executor', card: { requestType: 'permission', requestId: 'p1', action: 'read', tool: 'Read' } },
  })
  assert.deepEqual(ctx.permissions, [])
})
