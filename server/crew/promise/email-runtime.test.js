import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmailRunner } from './email-runtime.js'

const setup = ({ status = 'active', ready = true } = {}) => {
  const messages = []
  const room = {
    id: 'room-1',
    promise: {
      text: '每周发我',
      delivery: { channel: 'email', to: 'me@example.com' },
      status,
      version: 2,
    },
  }
  const store = {
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const change = mutate(room)
      return change === null ? null : room
    },
    appendMessage: (roomId, message) => { messages.push({ roomId, ...message }) },
  }
  const sent = []
  const runner = createEmailRunner({
    store,
    emit: () => {},
    ready: () => ready,
    send: async input => { sent.push(input); return { id: 'mail-1' } },
  })
  return { room, messages, sent, runner }
}

test('a delivered promise sends once and records the receipt', async () => {
  const ctx = setup()
  const handled = await ctx.runner({
    roomId: 'room-1',
    kind: 'email.send',
    payload: { to: 'me@example.com', subject: '周报', text: '正文', roundId: 'round-1' },
    attempts: 1,
    maxAttempts: 3,
  })
  assert.equal(handled, true)
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.room.promise.lastEmailStatus, 'sent')
  assert.equal(ctx.room.promise.lastEmailId, 'mail-1')
  assert.ok(ctx.messages.some(message => message.text.includes('已发到')))
})

test('without mail settings the promise is not sent and says why', async () => {
  const ctx = setup({ ready: false })
  await ctx.runner({
    roomId: 'room-1',
    kind: 'email.send',
    payload: { to: 'me@example.com', subject: '周报', text: '正文' },
  })
  assert.equal(ctx.sent.length, 0)
  assert.ok(ctx.messages.some(message => message.text.includes('邮箱还没接上')))
})

test('a paused promise does not send a late delivery', async () => {
  const ctx = setup({ status: 'paused' })
  await ctx.runner({
    roomId: 'room-1',
    kind: 'email.send',
    payload: { to: 'me@example.com', subject: '周报', text: '正文' },
  })
  assert.equal(ctx.sent.length, 0)
})
