import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageProjector, matchEcho } from './kernel/live/projection.js'
import { dropStaleStreams } from './rooms/chat/projection.js'

const projector = createMessageProjector({
  store: { readRoom: () => ({ seatBots: { executor: 'bot-1' }, hiddenBaseMessages: [] }) },
})

test('base digests never become a seat chat message', () => {
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

test('seat messages keep their seat author', () => {
  const stored = projector.toStored('room-1', { id: 'm1', kind: 'text', role: 'bot', authorRef: 'bot-1', text: '在' })
  assert.equal(stored.kind, 'chat')
  assert.equal(stored.authorId, 'executor')
})

test('stale stream placeholders give way to the final message', () => {
  const messages = [
    { id: 'stream:room-1:worker', authorId: 'worker', ts: 5, kind: 'chat', text: '甲' },
    { id: 'b1', authorId: 'worker', ts: 5, kind: 'chat', text: '甲' },
    { id: 'stream:room-1:worker-2', authorId: 'worker-2', ts: 6, kind: 'chat', text: '乙' },
  ]
  assert.deepEqual(dropStaleStreams(messages).map(message => message.id), ['b1', 'stream:room-1:worker-2'])
})

test('bare base names in prose become seat names', () => {
  const room = {
    seatBots: { worker: 'Worker6459f3' },
    seatNames: { worker: 'Worker6459f3' },
    seatSpecs: [{ id: 'worker', name: '甲' }],
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
