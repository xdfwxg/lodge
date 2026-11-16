import assert from 'node:assert/strict'
import test from 'node:test'
import { createHandoff } from './handoff.js'

const room = (over = {}) => ({
  id: 'room-1',
  goal: '把 hello 改成 greet',
  seatNames: { worker: 'WorkerBase', verifier: 'VerifierBase' },
  seatSpecs: [
    { id: 'worker', name: '执行官' },
    { id: 'verifier', name: '验收员' },
  ],
  stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
  plan: { done: ['测试通过'] },
  constraints: ['不改测试'],
  ...over,
})

const setup = (initial = room(), deliver = null) => {
  let current = initial
  const messages = []
  const events = []
  let seq = 0
  const store = {
    readRoom: () => current,
    readMessages: () => messages,
    appendMessage: (roomId, message) => {
      const stored = { ...message, id: `m-${++seq}`, roomId, seq, ts: 1 }
      messages.push(stored)
      return stored
    },
    upsertMessage: message => {
      const index = messages.findIndex(item => item.id === message.id)
      if (index >= 0) messages[index] = message
      return message
    },
    updateRoom: (roomId, mutate) => {
      mutate(current)
      return current
    },
    appendEvent: (roomId, type, payload) => events.push({ roomId, type, payload }),
  }
  const sent = []
  const handoff = createHandoff({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToSeat: deliver ?? (async (seat, text) => {
      sent.push({ seat, text })
      return { messageId: null }
    }),
  })
  return { handoff, store, messages, events, sent, room: () => current }
}

test('a handoff writes a work-turn card, wakes the seat and moves its cursor', async () => {
  const ctx = setup()
  const sent = await ctx.handoff.trigger({
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'dispatch',
    prompt: '阶段 1「实现」已确认。验收命令：npm test。',
    acceptance: 'npm test',
  })
  assert.equal(sent.meta.status, 'sent')
  assert.equal(sent.kind, 'handoff')
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.sent[0].seat, 'worker')
  assert.equal(ctx.sent[0].text, '阶段 1「实现」已确认。验收命令：npm test。')
  assert.equal(ctx.messages[0].kind, 'handoff')
  assert.equal(ctx.messages[0].meta.workTurn.done[0], '测试通过')
  assert.equal(ctx.room().seatCursors.worker, ctx.messages[0].seq)
  assert.deepEqual(ctx.events.map(event => event.type), ['handoff.requested', 'handoff.sent'])
})

test('a transport failure marks the handoff failed without changing the stage', async () => {
  const ctx = setup(room(), async () => {
    throw new Error('执行官 没有基座地址，消息没有送出')
  })
  await assert.rejects(
    () => ctx.handoff.trigger({
      room: ctx.room(),
      stage: ctx.room().stages[0],
      index: 0,
      from: 'lead',
      to: 'worker',
      reason: 'dispatch',
      prompt: '阶段开始',
      acceptance: 'npm test',
    }),
    /没有基座地址/,
  )
  assert.equal(ctx.messages[0].meta.status, 'failed')
  assert.equal(ctx.room().stages[0].state, 'active')
  assert.deepEqual(ctx.events.map(event => event.type), ['handoff.requested', 'handoff.failed'])
})
