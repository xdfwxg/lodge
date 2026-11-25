import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmailRunner } from './email-runtime.js'

const setup = ({ status = 'active', ready = true, duringSend = null } = {}) => {
  const messages = []
  const events = []
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
    appendEvent: (roomId, type, payload) => { events.push({ roomId, type, payload }) },
  }
  const sent = []
  const runner = createEmailRunner({
    store,
    emit: () => {},
    ready: () => ready,
    send: async input => {
      sent.push(input)
      if (typeof duringSend === 'function') duringSend(room)
      return { id: 'mail-1' }
    },
  })
  return { room, messages, events, sent, runner }
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

test('a promise edited during the send still records that the mail went out', async () => {
  const ctx = setup({ duringSend: room => { room.promise = { ...room.promise, version: 3, text: '改过的承诺' } } })
  await ctx.runner({
    roomId: 'room-1',
    kind: 'email.send',
    payload: { to: 'me@example.com', subject: '周报', text: '正文', roundId: 'round-1' },
    attempts: 1,
    maxAttempts: 3,
  })
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.room.promise.text, '改过的承诺')
  assert.equal(ctx.room.promise.lastEmailStatus, undefined)
  assert.ok(ctx.events.some(event => event.type === 'promise.emailed' && event.payload.versionChanged === true))
  assert.ok(ctx.messages.some(message => message.text.includes('承诺同时被改过')))
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
