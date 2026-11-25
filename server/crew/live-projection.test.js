import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageProjector, matchEcho } from './kernel/live/projection.js'
import { dropStaleStreams, dropTurnPreambles } from './rooms/chat/projection.js'

const projector = createMessageProjector({
  store: { readRoom: () => ({ members: [{ id: 'executor', name: '执行官', body: { kind: 'base', ref: 'bot-1', name: '执行官' } }], hiddenBaseMessages: [] }) },
})

test('base digests never become a member chat message', () => {
  assert.equal(projector.toStored('room-1', { id: 'd1', kind: 'digest', role: 'bot', text: '[digest]' }), null)
})

test('base notices stay system lines, not fake chat', () => {
  const stored = projector.toStored('room-1', { id: 'n1', kind: 'notice', role: 'bot', text: 'Paused: no new work.' })
  assert.equal(stored.kind, 'system')
  assert.match(stored.text, /Paused/)
})

test('empty trailing base messages never become empty chat bubbles', () => {
  assert.equal(projector.toStored('room-1', { id: 'm2', kind: 'text', role: 'bot', authorRef: 'bot-1', text: '' }), null)
  assert.equal(projector.toStored('room-1', { id: 'm3', kind: 'text', role: 'bot', authorRef: 'bot-1', text: '  ' }), null)
})

test('internal orchestration prompts never become user chat', () => {
  assert.equal(projector.toStored('room-1', {
    id: 'p1',
    kind: 'text',
    role: 'user',
    text: '@规划师 阶段 2 已确认。\n[[lodge-internal]]',
  }), null)
})

test('an echo matches its queued base message once', () => {
  const now = Date.now()
  const echo = { id: 'e1', authorId: 'you', text: '你好', ts: now, meta: { echo: true } }
  assert.equal(matchEcho([echo], '你好', now + 500), echo)
  assert.equal(matchEcho([{ ...echo, meta: { echo: true, baseId: 'b1' } }], '你好', now), undefined)
  assert.equal(matchEcho([echo], '你好', now + 200_000), undefined)
  assert.equal(matchEcho([echo], '别的', now), undefined)
})

test('a question card stays answerable instead of becoming a system line', () => {
  const stored = projector.toStored('room-1', {
    id: 'q1',
    kind: 'question',
    role: 'bot',
    authorRef: 'bot-1',
    text: '选哪个方案？',
    card: { requestId: 'ask-1', requestType: 'question', options: ['A', 'B'] },
  })
  assert.equal(stored.kind, 'question')
  assert.equal(stored.authorId, 'executor')
  assert.deepEqual(stored.meta.card.options, ['A', 'B'])
})

test('the chat host never becomes a member bubble in a multi-person room', () => {
  const chatProjector = createMessageProjector({
    store: {
      readRoom: () => ({
        roomType: 'chat',
        members: [{ id: 'a', name: '甲', body: { kind: 'base', ref: 'bot-a' } }],
        chatHost: { memberRef: 'host-bot' },
        hiddenBaseMessages: [],
      }),
    },
  })
  assert.equal(chatProjector.toStored('room-1', {
    id: 'h1',
    kind: 'text',
    role: 'bot',
    authorRef: 'host-bot',
    text: '{"cast":[{"id":"a","focus":"成本"}]}',
  }), null)
  assert.equal(chatProjector.toStored('room-1', {
    id: 'a1',
    kind: 'text',
    role: 'bot',
    authorRef: 'bot-a',
    text: '我来说一句。',
  }).authorId, 'a')
})

test('member messages keep their member author', () => {
  const stored = projector.toStored('room-1', { id: 'm1', kind: 'text', role: 'bot', authorRef: 'bot-1', text: '在' })
  assert.equal(stored.kind, 'chat')
  assert.equal(stored.authorId, 'executor')
})

test('a member text keeps its turn identity so the room can keep only the ending', () => {
  const stored = projector.toStored('room-1', {
    id: 'm1', kind: 'text', role: 'agent', authorRef: 'bot-1', text: '我先看下。', turnId: 'turn-1', turnFinal: false,
  })
  assert.deepEqual(stored.meta, { turnId: 'turn-1', turnFinal: false })
  const final = projector.toStored('room-1', {
    id: 'm2', kind: 'text', role: 'agent', authorRef: 'bot-1', text: '结论是…', turnId: 'turn-1', turnFinal: true,
  })
  assert.deepEqual(final.meta, { turnId: 'turn-1', turnFinal: true })
  // runtime 没标收尾：只留回合身份，不把这条当成过场。
  const unmarked = projector.toStored('room-1', {
    id: 'm3', kind: 'text', role: 'agent', authorRef: 'bot-1', text: '一句完整发言。', turnId: 'turn-2',
  })
  assert.deepEqual(unmarked.meta, { turnId: 'turn-2' })
})

test('one answer split into a preamble and a body shows only the body', () => {
  const messages = [
    { id: 'm1', authorId: 'worker-2', ts: 100, kind: 'chat', text: '我先看下实际代码和测试，再判断。', meta: { turnId: 'turn-1' } },
    { id: 'm2', authorId: 'worker-2', ts: 104, kind: 'chat', text: '接住上一位——测试写得挺齐全。', meta: { turnId: 'turn-1', turnFinal: true } },
    { id: 'm3', authorId: 'worker', ts: 110, kind: 'chat', text: '我同意。', meta: { turnId: 'turn-2' } },
  ]
  assert.deepEqual(dropTurnPreambles(messages).map(message => message.id), ['m2', 'm3'])
})

test('a turn that only got its first line keeps that line', () => {
  const messages = [
    { id: 'm1', authorId: 'worker-2', ts: 100, kind: 'chat', text: '我先看下。', meta: { turnId: 'turn-1' } },
  ]
  assert.deepEqual(dropTurnPreambles(messages).map(message => message.id), ['m1'])
})

test('messages without a turn id are never folded together', () => {
  const messages = [
    { id: 'a', authorId: 'worker', ts: 5, kind: 'chat', text: '甲', meta: { final: true, turnId: '' } },
    { id: 'b', authorId: 'worker', ts: 9, kind: 'chat', text: '乙', meta: { final: true, turnId: '' } },
  ]
  assert.deepEqual(dropTurnPreambles(messages).map(message => message.id), ['a', 'b'])
})

test('two members saying the same words in different turns both stay', () => {
  const messages = [
    { id: 'm1', authorId: 'worker', ts: 100, kind: 'chat', text: '同意。', meta: { turnId: 'turn-1' } },
    { id: 'm2', authorId: 'worker-2', ts: 101, kind: 'chat', text: '同意。', meta: { turnId: 'turn-2' } },
  ]
  assert.deepEqual(dropTurnPreambles(messages).map(message => message.id), ['m1', 'm2'])
})

test('stale stream placeholders give way to the final message', () => {
  const messages = [
    { id: 'stream:room-1:worker', authorId: 'worker', ts: 5, kind: 'chat', text: '甲' },
    { id: 'b1', authorId: 'worker', ts: 5, kind: 'chat', text: '甲' },
    { id: 'stream:room-1:worker-2', authorId: 'worker-2', ts: 6, kind: 'chat', text: '乙', meta: { final: true } },
  ]
  assert.deepEqual(dropStaleStreams(messages).map(message => message.id), ['b1', 'stream:room-1:worker-2'])
})

test('two identical final streams in the same moment keep only the first', () => {
  const messages = [
    { id: 'stream:room-1:worker:a', authorId: 'worker', ts: 5, kind: 'chat', text: '甲', meta: { final: true } },
    { id: 'stream:room-1:worker:b', authorId: 'worker', ts: 105, kind: 'chat', text: '甲', meta: { final: true } },
    { id: 'stream:room-1:worker:c', authorId: 'worker', ts: 20_000, kind: 'chat', text: '甲', meta: { final: true } },
  ]
  assert.deepEqual(dropStaleStreams(messages).map(message => message.id), [
    'stream:room-1:worker:a',
    'stream:room-1:worker:c',
  ])
})

test('a shorter final stream gives way to the complete copy', () => {
  const messages = [
    { id: 'stream:room-1:worker:a', authorId: 'worker', ts: 5, kind: 'chat', text: '前半句', meta: { final: true } },
    { id: 'stream:room-1:worker:b', authorId: 'worker', ts: 70, kind: 'chat', text: '前半句，后半句', meta: { final: true } },
  ]
  assert.deepEqual(dropStaleStreams(messages).map(message => message.id), ['stream:room-1:worker:b'])
})

test('line breaks do not hide a duplicate stream', () => {
  const messages = [
    { id: 'stream:room-1:worker:a', authorId: 'worker', ts: 5, kind: 'chat', text: '前半句。\n\n后半句。', meta: { final: true } },
    { id: 'stream:room-1:worker:b', authorId: 'worker', ts: 70, kind: 'chat', text: '前半句。 后半句。', meta: { final: true } },
  ]
  assert.deepEqual(dropStaleStreams(messages).map(message => message.id), ['stream:room-1:worker:a'])
})

test('a stale final stream is never shown', () => {
  const messages = [
    { id: 'stream:room-1:worker:a', authorId: 'worker', ts: 5, kind: 'chat', text: '甲', meta: { final: true, stale: true } },
  ]
  assert.deepEqual(dropStaleStreams(messages), [])
})

test('bare base names in prose become member names', () => {
  const room = {
    members: [{ id: 'worker', name: '甲', body: { kind: 'base', ref: 'Worker6459f3', name: 'Worker6459f3' } }],
  }
  const chatProjector = createMessageProjector({ store: { readRoom: () => room } })
  const stored = chatProjector.toStored('room-1', {
    id: 'm2',
    kind: 'text',
    role: 'bot',
    authorRef: 'Worker6459f3',
    text: 'Worker6459f3 同意，另一个人不同意。',
  })
  assert.equal(stored.text, '甲 同意，另一个人不同意。')
})

test('tool activity keeps what it is doing for the room status', () => {
  const stored = projector.toStored('room-1', {
    id: 'a1',
    kind: 'activity',
    role: 'bot',
    authorRef: 'bot-1',
    text: 'Bash',
    tool: { name: 'Bash', step: { activity: 'command', target: 'pip', detail: 'python3 -m pip install opencv-python-headless' } },
    ok: true,
    at: Date.now(),
  })
  assert.equal(stored.kind, 'activity')
  assert.equal(stored.meta.action, 'exec')
  assert.equal(stored.meta.target, 'pip')
  assert.match(stored.meta.detail, /opencv/)
})
