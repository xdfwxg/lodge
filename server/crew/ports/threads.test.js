import assert from 'node:assert/strict'
import test from 'node:test'
import { createThreadPort } from './threads.js'

const port = messages => createThreadPort({
  store: { readRoom: () => ({ chatRoom: { sessionRef: 'thread-1' } }) },
  engine: { history: async () => ({ messages }) },
  roomId: 'room-1',
})

const text = (id, value, extra = {}) => ({
  id,
  kind: 'text',
  role: 'agent',
  authorRef: 'bot-1',
  text: value,
  ...extra,
})

test('a reply is the last line of the turn, not the opening remark', async () => {
  const reply = await port([
    text('m1', '我先看下实际代码和测试，再判断。', { turnId: 't1', turnFinal: false }),
    text('m2', '接住上一位——五条规则各有用例。', { turnId: 't1', turnFinal: true }),
  ]).findReply('bot-1', new Set())
  assert.deepEqual(reply, { text: '接住上一位——五条规则各有用例。', turnId: 't1' })
})

test('a turn still in progress is not a reply yet', async () => {
  const reply = await port([
    text('m1', '我先看下。', { turnId: 't1', turnFinal: false }),
  ]).findReply('bot-1', new Set())
  assert.equal(reply, null)
})

test('a finished turn digest wins over its text', async () => {
  const reply = await port([
    text('m1', '我先看下。', { turnId: 't1', turnFinal: false }),
    { id: 'd1', kind: 'turn', authorRef: 'bot-1', turn: { turnId: 't1', reply: '整段回答。' } },
  ]).findReply('bot-1', new Set())
  assert.deepEqual(reply, { text: '整段回答。', turnId: 't1' })
})

test('runtimes that never mark turn endings still read the latest text', async () => {
  const reply = await port([
    text('m1', '第一句。'),
    text('m2', '第二句。'),
  ]).findReply('bot-1', new Set())
  assert.deepEqual(reply, { text: '第二句。', turnId: '' })
})

test('messages already counted before sending are not a new reply', async () => {
  const reply = await port([
    text('m1', '上一句。', { turnId: 't0', turnFinal: true }),
  ]).findReply('bot-1', new Set(['m1']))
  assert.equal(reply, null)
})
