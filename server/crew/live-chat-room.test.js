import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_TURNS_PER_ROUND, turnLimitOf as chatTurnLimitOf } from './room-types/chat.js'
import { createChatScheduler, pickChatSpeaker } from './rooms/chat/scheduler.js'
import { createChatTransport } from './rooms/chat/transport.js'
import { normalizeTestRoom } from './testing/room.js'

test('a chat round caps at four speakers and accepts a lower room limit', () => {
  assert.equal(CHAT_TURNS_PER_ROUND, 4)
  assert.equal(chatTurnLimitOf({}), 4)
  assert.equal(chatTurnLimitOf({ chat: { turnLimit: 2 } }), 2)
  assert.equal(chatTurnLimitOf({ chat: { turnLimit: 99 } }), 4)
})

const PERSONAS = ['assertive', 'cheerful', 'calm', 'rigorous', 'gentle', 'balanced']

const setup = ({ summaryText = '这是总结。', silent = false, busy = false, replyText = '这是发言。', extraMember = false, count = null } = {}) => {
  const total = count ?? (extraMember ? 3 : 2)
  const members = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, total)
  const seatNames = Object.fromEntries(members.map(id => [id, id.toUpperCase()]))
  let current = normalizeTestRoom({
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
      running: false,
      speaker: '',
      note: '',
    },
    members,
    seatBots: seatNames,
    seatNames,
    seatSpecs: members.map((id, index) => ({
      id,
      name: '甲乙丙丁戊己'[index],
      personality: PERSONAS[index],
    })),
    chatHost: { memberRef: 'H', name: 'LodgeHost', displayName: 'Lodge 主持' },
    chatRoom: { id: 'chat', sessionRef: 'thread' },
  })
  const messages = []
  const history = []
  const events = []
  const store = {
    readRoom: () => current,
    readMessages: () => messages,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      const result = mutate(next)
      if (result === null) return null
      current = next
      if (Array.isArray(result?.events)) events.push(...result.events)
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
    rooms: async () => [{ id: 'chat', working: busy }],
    sendTurn: async ({ text }) => {
      const ref = text.includes('LodgeHost') ? 'H' : Object.values(seatNames).find(item => text.includes(`@${item}`))
      const summary = text.includes('请总结')
      const id = `u${history.length + 1}`
      history.push({ id, role: 'user', kind: 'text', text, authorRef: null, at: Date.now() })
      if (!silent) {
        history.push({
          id: `a${history.length + 1}`,
          role: 'agent',
          kind: 'text',
          text: summary ? summaryText : replyText,
          authorRef: ref,
          at: Date.now(),
        })
      }
      if (!summary && !silent) {
        const authorId = Object.entries(current.seatBots).find(([, value]) => value === ref)?.[0]
        store.appendMessage(current.id, { kind: 'chat', authorId, text: replyText })
      }
      return { accepted: true, messageId: id }
    },
  }
  const sendToMember = async (member, text) => {
    const name = member === 'host' ? current.chatHost.name : current.seatNames[member]
    return engine.sendTurn({ roomId: current.chatRoom.id, text: `@${name} ${text}` })
  }
  return { store, engine, sendToMember, room: () => current, messages, history, events }
}

const transportFor = ctx => createChatTransport({ engine: ctx.engine, store: ctx.store, roomId: 'room-chat' })

test('a conclusion already written is not summarized twice after a crash', async () => {
  const ctx = setup()
  ctx.room().members = []
  ctx.room().chat = { ...ctx.room().chat, phase: 'discussing', running: false, turns: 6, round: 1 }
  ctx.messages.push({ kind: 'chat_conclusion', id: 'c-1', authorId: 'lodge', text: '已经有结论', meta: { round: 1 } })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room(), { resume: true })
  assert.equal(result.recovered, true)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat_conclusion').length, 1)
  assert.equal(ctx.room().chat.phase, 'concluded')
  assert.equal(ctx.room().chat.interrupted, false)
})

test('a cancelled chat round stays resumable instead of looking busy', async () => {
  const ctx = setup()
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    waitMs: 100,
    pollMs: 1,
  })
  const run = scheduler.start(ctx.room())
  scheduler.cancel()
  const result = await run
  assert.equal(result.cancelled, true)
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.room().chat.interrupted, true)
  assert.equal(ctx.room().chat.phase, 'discussing')
})

test('a resumed chat round continues from the turns already spoken', async () => {
  const ctx = setup({ extraMember: true })
  ctx.room().chat = { ...ctx.room().chat, running: true, phase: 'discussing', round: 1, turns: 1 }
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room(), { resume: true })
  assert.equal(result.started, true)
  assert.equal(result.turns, 3)
  assert.equal(ctx.messages.some(message => message.meta?.opening === true), false)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat' && message.authorId !== 'lodge').length, 2)
})

test('a resumed chat round counts a reply that arrived before the crash', async () => {
  const ctx = setup()
  ctx.room().chat = {
    ...ctx.room().chat,
    running: true,
    turns: 0,
    pending: { turn: 1, memberId: 'a', beforeIds: [], sentAt: Date.now() - 1_000 },
  }
  ctx.history.push({ id: 'a-pending', role: 'agent', kind: 'text', text: '先到的回复。', authorRef: 'A', at: Date.now() })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room(), { resume: true })
  assert.equal(result.turns, 2)
  assert.equal(ctx.room().chat.pending, null)
  assert.equal(ctx.history.some(message => message.role === 'user' && /第 1\/2 次发言/.test(message.text)), false)
  assert.equal(ctx.history.filter(message => message.role === 'user' && /聊天室话题/.test(message.text)).length, 1)
  assert.ok(ctx.events.some(event => (
    event.type === 'chat.turn_recovered' &&
    event.payload.turn === 1 &&
    event.payload.memberId === 'a' &&
    event.payload.found === true
  )))
})

test('a pending chat turn with no reply is skipped, not sent twice', async () => {
  const ctx = setup()
  ctx.room().chat = {
    ...ctx.room().chat,
    running: true,
    turns: 0,
    pending: { turn: 1, memberId: 'a', beforeIds: [], sentAt: Date.now() - 1_000 },
  }
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room(), { resume: true })
  assert.equal(result.started, true)
  assert.equal(ctx.history.some(message => message.role === 'user' && /第 1\/2 次发言/.test(message.text)), false)
  assert.equal(ctx.messages.some(message => /没有在限定时间内回应/.test(message.text ?? '')), true)
  assert.equal(ctx.history.filter(message => message.role === 'user' && /聊天室话题/.test(message.text)).length, 1)
  assert.ok(ctx.events.some(event => (
    event.type === 'chat.turn_missed' &&
    event.payload.turn === 1 &&
    event.payload.memberId === 'a' &&
    event.payload.found === false
  )))
})

test('a malformed host answer can still recover a round', async () => {
  const ctx = setup()
  const replies = [
    '我先想想。',
    '{"action":"round","speakers":["a"],"reply":"那就聊一轮。"}',
  ]
  const prompts = []
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: async (member, text) => {
      prompts.push(text)
      const id = `u${ctx.history.length + 1}`
      ctx.history.push({ id, role: 'user', kind: 'text', text, authorRef: null, at: Date.now() })
      const reply = replies.shift()
      if (reply !== undefined) {
        ctx.history.push({
          id: `a${ctx.history.length + 1}`,
          role: 'agent',
          kind: 'text',
          text: reply,
          authorRef: 'H',
          at: Date.now(),
        })
      }
      return { messageId: id }
    },
    roomId: 'room-chat',
    waitMs: 100,
    pollMs: 1,
  })
  const intent = await scheduler.hostIntent(ctx.room(), '大家说说')
  assert.equal(intent.action, 'round')
  assert.deepEqual(intent.speakers, ['a'])
  assert.match(prompts[1], /"action":"round"/)
})

test('a chat round runs up to four speakers, then the host summarizes', async () => {
  const ctx = setup({ count: 4 })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room())
  assert.equal(result.started, true)
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.room().chat.phase, 'concluded')
  const opening = ctx.messages.find(message => message.kind === 'chat' && message.meta?.opening === true)
  assert.equal(opening.text, '【讨论状态提示】')
  assert.doesNotMatch(opening.text, /欢迎大家踊跃发言/)
  assert.doesNotMatch(opening.text, /先发言/)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat' && message.authorId !== 'lodge').length, 4)
  const conclusion = ctx.messages.find(message => message.kind === 'chat_conclusion')
  assert.equal(conclusion.meta.round, 1)
  assert.equal(conclusion.meta.turns, 4)
  assert.equal(conclusion.meta.fallback, false)
  assert.deepEqual(conclusion.meta.handoffBrief, {
    topic: '讨论状态提示',
    consensus: ['这是总结。'],
    disagreements: [],
    unknowns: [],
    constraints: [],
    todos: [],
  })
  assert.equal(ctx.room().chat.conclusionId, conclusion.id)
  const prompts = ctx.history.filter(message => message.role === 'user').map(message => message.text)
  assert.equal(prompts.some(text => text.includes('已有讨论')), false)
  // 每轮最多四个人，且每人只说一次。
  const spoken = ctx.messages
    .filter(message => message.kind === 'chat' && message.authorId !== 'lodge')
    .map(message => message.authorId)
  assert.deepEqual([...spoken].sort(), ['a', 'b', 'c', 'd'])
  assert.equal(prompts.filter(text => !text.includes('请总结')).every(text => text.length < 400), true)
  assert.equal(prompts.filter(text => text.includes('请总结')).every(text => text.length < 900), true)

  ctx.store.updateRoom('room-chat', state => {
    state.chat = { ...state.chat, round: 2, running: false, turns: 0, phase: 'concluded' }
    return { events: [] }
  })
  const next = await scheduler.start(ctx.room(), { note: '补充失败态' })
  assert.equal(next.started, true)
  assert.equal(ctx.messages.filter(message => message.kind === 'chat' && message.authorId !== 'lodge').length, 8)
  const conclusions = ctx.messages.filter(message => message.kind === 'chat_conclusion')
  assert.equal(conclusions.length, 2)
  assert.equal(conclusions.at(-1).meta.round, 2)
})

test('the host picks tonight’s cast and the opening names them', async () => {
  const ctx = setup({ count: 6 })
  const sendToMember = async (member, text) => {
    if (member !== 'host' || !text.includes('选今晚')) return ctx.sendToMember(member, text)
    const id = `u${ctx.history.length + 1}`
    ctx.history.push({ id, role: 'user', kind: 'text', text, authorRef: null, at: Date.now() })
    ctx.history.push({
      id: `a${ctx.history.length + 1}`,
      role: 'agent',
      kind: 'text',
      authorRef: 'H',
      at: Date.now(),
      text: JSON.stringify({
        cast: [{ id: 'b', focus: '这轮只看成本' }, { id: 'e', focus: '这轮只看三个月后' }],
        why: '先看成本和长期',
      }),
    })
    return { messageId: id }
  }
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room(), { selectCast: true })
  assert.equal(result.started, true)
  assert.deepEqual(ctx.room().chat.castIds, ['b', 'e'])
  assert.deepEqual(ctx.room().chat.castFocus, { b: '这轮只看成本', e: '这轮只看三个月后' })
  const opening = ctx.messages.find(message => message.meta?.opening === true)
  assert.equal(opening.text, '今晚请到 2 位：乙看成本，戊看三个月后（先看成本和长期）')
  const spoken = ctx.messages
    .filter(message => message.kind === 'chat' && message.authorId !== 'lodge')
    .map(message => message.authorId)
  assert.deepEqual([...spoken].sort(), ['b', 'e'])
})

test('the default chat summary asks for a short conclusion, not three sections', async () => {
  const ctx = setup()
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room())
  const summary = ctx.history.find(message => message.role === 'user' && /请总结/.test(message.text))
  assert.ok(summary)
  assert.doesNotMatch(summary.text, /## 主题/)
  assert.match(summary.text, /只写两三句/)
  assert.match(summary.text, /不超过 100 字/)
  assert.doesNotMatch(summary.text, /固定写三段/)
})

test('a natural summary still becomes a studio handoff', async () => {
  const ctx = setup({ summaryText: '这轮定下了导出方案。\n下一步：补一个导出按钮。' })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room())
  const conclusion = ctx.messages.find(message => message.kind === 'chat_conclusion')
  assert.ok(conclusion)
  assert.equal(conclusion.meta.handoffBrief.topic, '讨论状态提示')
  assert.deepEqual(conclusion.meta.handoffBrief.consensus, ['这轮定下了导出方案。'])
  assert.deepEqual(conclusion.meta.handoffBrief.todos, ['补一个导出按钮。'])
})

test('an explicit request for a list keeps the structured summary', async () => {
  const ctx = setup()
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room(), { note: '分点列出待办' })
  const summary = ctx.history.find(message => message.role === 'user' && /请总结/.test(message.text))
  assert.ok(summary)
  assert.match(summary.text, /## 主题/)
})

test('stances pick a complementary next speaker before random', () => {
  const stances = { a: 'proposer', b: 'critic', c: 'synthesizer' }
  const counts = new Map([['a', 1], ['b', 1], ['c', 1]])
  const pick = last => pickChatSpeaker({
    speakers: ['a', 'b', 'c'],
    counts,
    perMember: 6,
    last,
    stanceOf: id => stances[id],
    random: () => 0,
  })
  assert.equal(pick('a'), 'b')
  assert.equal(pick('b'), 'c')
  assert.equal(pick('c'), 'a')
})

test('a resumed round keeps the fair order from the messages already spoken', async () => {
  const ctx = setup({ extraMember: true })
  ctx.store.appendMessage('room-chat', {
    kind: 'chat',
    authorId: 'lodge',
    text: '【讨论状态提示】',
    meta: { opening: true, round: 1 },
  })
  ctx.store.appendMessage('room-chat', { kind: 'chat', authorId: 'a', text: '先说一句。' })
  ctx.store.appendMessage('room-chat', { kind: 'chat', authorId: 'a', text: '再补一句。' })
  ctx.store.updateRoom('room-chat', state => {
    state.chat = { ...state.chat, running: true, turns: 2, round: 1 }
    return { events: [] }
  })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room(), { resume: true })
  const spoken = ctx.messages
    .filter(message => message.kind === 'chat' && ['a', 'b', 'c'].includes(message.authorId))
    .map(message => message.authorId)
  // 续跑接着没说过的人：轮到 b，不再让已经说过两次的 a 先来。
  assert.deepEqual(spoken.slice(2), ['b'])
})

test('a member @ does not change the scheduled next speaker', async () => {
  const ctx = setup({ replyText: '@C 你来。', extraMember: true })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room())
  const spoken = ctx.messages
    .filter(message => message.kind === 'chat' && message.authorId !== 'lodge')
    .map(message => message.authorId)
  assert.deepEqual(spoken.slice(0, 2), ['a', 'b'])
  assert.equal(ctx.history.some(message => /lodge-floor|让给/.test(message.text)), false)
})

test('a round gives every member a turn before repeating', async () => {
  const ctx = setup({ extraMember: true })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room())
  const spoken = ctx.messages
    .filter(message => message.kind === 'chat' && message.authorId !== 'lodge')
    .map(message => message.authorId)
  assert.deepEqual(spoken.slice(0, 3).sort(), ['a', 'b', 'c'])
})

test('the host conclusion keeps all six handoff fields', async () => {
  const ctx = setup({
    summaryText: [
      '## 主题',
      '状态提示',
      '## 共识',
      '- 用一句话说明',
      '## 分歧',
      '- 无',
      '## 未定',
      '- 还没验证',
      '## 约束',
      '- 不改接口',
      '## 待办',
      '- 写测试',
    ].join('\n'),
  })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  await scheduler.start(ctx.room())
  const conclusion = ctx.messages.find(message => message.kind === 'chat_conclusion')
  assert.deepEqual(conclusion.meta.handoffBrief, {
    topic: '状态提示',
    consensus: ['用一句话说明'],
    disagreements: [],
    unknowns: ['还没验证'],
    constraints: ['不改接口'],
    todos: ['写测试'],
  })
})

test('a late member message is synced before the host concludes', async () => {
  const ctx = setup()
  let synced = false
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
    syncChat: async () => {
      if (synced) return
      synced = true
      ctx.store.appendMessage('room-chat', { kind: 'chat', authorId: 'a', text: '甲补充' })
    },
  })
  await scheduler.start(ctx.room())
  const late = ctx.messages.findIndex(message => message.text === '甲补充')
  const conclusion = ctx.messages.findIndex(message => message.kind === 'chat_conclusion')
  assert.ok(late >= 0)
  assert.ok(late < conclusion)
})

test('a chat room can run fewer turns than the default', async () => {
  const ctx = setup()
  ctx.store.updateRoom('room-chat', state => {
    state.chat = { ...state.chat, turnLimit: 2 }
    return { events: [] }
  })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
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


test('a busy base skips the round instead of queueing every speaker', async () => {
  const ctx = setup({ busy: true })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 10,
    pollMs: 1,
    idleMs: 5,
  })
  await scheduler.start(ctx.room())
  assert.equal(ctx.history.filter(message => message.role === 'user' && !message.text.includes('请总结')).length, 0)
  assert.ok(ctx.messages.some(message => /Lodge 服务一直忙/.test(message.text ?? '')))
  assert.equal(ctx.messages.some(message => message.kind === 'chat_conclusion'), false)
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.room().chat.interrupted, true)
})

test('a member muted mid-round does not get the next turn', async () => {
  const ctx = setup({ count: 3 })
  let muted = false
  const sendToMember = async (member, text) => {
    const result = await ctx.sendToMember(member, text)
    if (!muted) {
      muted = true
      ctx.store.updateRoom('room-chat', state => {
        state.chat = { ...state.chat, mutedIds: ['c'] }
        return { events: [] }
      })
    }
    return result
  }
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 100,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room())
  assert.equal(result.turns, 2)
  const spoken = ctx.messages
    .filter(message => message.kind === 'chat' && message.authorId !== 'lodge')
    .map(message => message.authorId)
  assert.deepEqual(spoken, ['a', 'b'])
})

test('a round with everyone muted stops cleanly instead of staying running', async () => {
  const ctx = setup()
  ctx.store.updateRoom('room-chat', state => {
    state.chat = { ...state.chat, mutedIds: ['a', 'b'] }
    return { events: [] }
  })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 10,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room())
  assert.equal(result.started, false)
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.room().chat.interrupted, true)
  assert.ok(ctx.messages.some(message => /没有人能发言/.test(message.text ?? '')))
  assert.equal(ctx.messages.some(message => message.kind === 'chat_conclusion'), false)
})

test('three silent speakers end the round early', async () => {
  const ctx = setup({ silent: true, count: 3 })
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    random: () => 0,
    waitMs: 5,
    pollMs: 1,
    idleMs: 5,
  })
  await scheduler.start(ctx.room())
  assert.ok(ctx.messages.some(message => /本轮提前收尾/.test(message.text ?? '')))
  assert.equal(ctx.history.filter(message => message.role === 'user' && /@[ABC]/.test(message.text)).length, 3)
})

test('a history failure stops the round instead of writing a fake conclusion', async () => {
  const ctx = setup()
  ctx.engine.history = async () => { throw new Error('engine 鉴权失败') }
  const scheduler = createChatScheduler({
    store: ctx.store,
    transport: transportFor(ctx),
    sendToMember: ctx.sendToMember,
    roomId: 'room-chat',
    waitMs: 20,
    pollMs: 1,
  })
  const result = await scheduler.start(ctx.room())
  assert.ok(result.error)
  assert.equal(ctx.messages.some(message => message.kind === 'chat_conclusion'), false)
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.room().chat.interrupted, true)
})
