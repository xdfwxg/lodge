import assert from 'node:assert/strict'
import test from 'node:test'
import { createHandoff } from './handoff.js'
import { transitionAssignment } from '../../assignments.js'
import { normalizeTestRoom, withAssignments } from '../../testing/room.js'

const room = (over = {}) => normalizeTestRoom({
  id: 'room-1',
  goal: '把 hello 改成 greet',
  seatNames: { worker: 'WorkerBase', verifier: 'VerifierBase' },
  seatSpecs: [
    { id: 'worker', name: '执行官' },
    { id: 'verifier', name: '验收员' },
  ],
  stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
  plan: { done: ['测试通过'] },
  constraints: ['不改测试'],
  ...over,
})

const setup = (initial = room(), deliver = null) => {
  let current = initial
  const messages = []
  const events = []
  let seq = 0
  const store = withAssignments({
    readRoom: () => current,
    readMessage: (roomId, id) => messages.find(item => item.id === id) ?? null,
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
  })
  const sent = []
  const handoff = createHandoff({
    store,
    roomId: 'room-1',
    emit: () => {},
    sendToMember: deliver ?? (async (memberId, text, options = {}) => {
      sent.push({ memberId, text, options })
      return { messageId: null }
    }),
  })
  return { handoff, store, messages, events, sent, room: () => current }
}

test('a handoff writes an assignment, wakes the member and writes no room message', async () => {
  const ctx = setup()
  const sent = await ctx.handoff.trigger({
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'dispatch',
    prompt: '阶段 1「实现」已确认。验收命令：npm test。',
  })
  assert.equal(sent.status, 'sent')
  assert.equal(sent.reason, 'dispatch')
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.sent[0].memberId, 'worker')
  assert.equal(ctx.sent[0].text, '阶段 1「实现」已确认。验收命令：npm test。')
  assert.equal(ctx.sent[0].options.intent, 'handoff')
  assert.equal(ctx.sent[0].options.from, 'lead')
  assert.equal(ctx.sent[0].options.sendId, sent.sendId)
  assert.match(ctx.sent[0].options.sendId, /^a-[a-f0-9]{32}$/)
  assert.equal(ctx.messages.length, 0)
  assert.equal(ctx.store.readAssignment(sent.id).brief.done[0], '测试通过')
  assert.deepEqual(ctx.events.map(event => event.type), ['assignment.created', 'assignment.sent'])
})

test('a sent handoff is not woken again', async () => {
  const ctx = setup()
  const params = {
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'dispatch',
    prompt: '阶段 1「实现」已确认。',
  }
  await ctx.handoff.trigger(params)
  await ctx.handoff.trigger(params)
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.store.readAssignments('room-1').length, 1)
})

test('a transport failure marks the handoff failed without changing the stage', async () => {
  const ctx = setup(room(), async () => {
    throw new Error('执行官 还没有连上 Lodge 服务，消息没有送出')
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
    }),
    /还没有连上 Lodge 服务/,
  )
  assert.equal(ctx.store.readAssignments('room-1')[0].status, 'failed')
  assert.equal(ctx.room().stages[0].state, 'active')
  assert.deepEqual(ctx.events.map(event => event.type), ['assignment.created', 'assignment.failed'])
})

test('a retry after a transport failure reopens the same assignment', async () => {
  let attempts = 0
  const ctx = setup(room(), async () => {
    attempts += 1
    if (attempts === 1) throw new Error('暂时送不到')
    return { messageId: null }
  })
  const params = {
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'dispatch',
    prompt: '阶段 1「实现」已确认。',
  }
  await assert.rejects(() => ctx.handoff.trigger(params), /暂时送不到/)
  const failed = ctx.store.readAssignments('room-1')[0]
  assert.equal(failed.status, 'failed')
  const sent = await ctx.handoff.trigger({ ...params, prompt: '重试时的新提示' })
  const rows = ctx.store.readAssignments('room-1')
  assert.equal(rows.length, 1)
  assert.equal(sent.id, failed.id)
  assert.equal(sent.parentAssignmentId, null)
  assert.equal(sent.status, 'sent')
  assert.equal(sent.resultText, '')
  assert.equal(sent.deliveryFailed, false)
  assert.equal(ctx.store.readAssignment(failed.id).finishedAt, null)
  assert.equal(ctx.store.readAssignment(failed.id).brief.prompt, '重试时的新提示')
  assert.deepEqual(ctx.events.map(event => event.type), [
    'assignment.created', 'assignment.failed', 'assignment.sent',
  ])
  assert.equal(ctx.store.readMessages().length, 0)
})

test('a work failure re-dispatches as a new beat, not a delivery retry', async () => {
  const ctx = setup()
  const params = {
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'dispatch',
    prompt: '阶段 1「实现」已确认。',
  }
  const first = await ctx.handoff.trigger(params)
  transitionAssignment(ctx.store, first.id, 'working')
  transitionAssignment(ctx.store, first.id, 'failed', { resultText: '没有产出' })
  const second = await ctx.handoff.trigger(params)
  const rows = ctx.store.readAssignments('room-1')
  assert.equal(rows.length, 2)
  assert.notEqual(second.id, first.id)
  assert.equal(second.parentAssignmentId, first.id)
  assert.equal(second.deliveryFailed, false)
})

test('a delivered assignment is not woken twice', async () => {
  const ctx = setup()
  const params = {
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'dispatch',
    prompt: '阶段 1「实现」已确认。',
  }
  const first = await ctx.handoff.trigger(params)
  ctx.store.updateAssignment(first.id, assignment => {
    assignment.status = 'reported'
    return true
  })
  const second = await ctx.handoff.trigger(params)
  assert.equal(second.status, 'reported')
  assert.equal(ctx.sent.length, 1)
  assert.equal(ctx.messages.length, 0)
})

test('a second rework beat reaches the executor even after the first one reported', async () => {
  const ctx = setup()
  const params = {
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'rework',
    prompt: '按验收意见重做。',
    rework: true,
    nonce: 'rework-1',
  }
  const first = await ctx.handoff.trigger(params)
  ctx.store.updateAssignment(first.id, assignment => {
    assignment.status = 'reported'
    return true
  })
  const second = await ctx.handoff.trigger({ ...params, nonce: 'rework-2' })
  assert.equal(ctx.sent.length, 2)
  assert.notEqual(second.id, first.id)
  assert.equal(ctx.store.readAssignments('room-1').length, 2)
})

test('replaying the same rework beat stays idempotent', async () => {
  const ctx = setup()
  const params = {
    room: ctx.room(),
    stage: ctx.room().stages[0],
    index: 0,
    from: 'lead',
    to: 'worker',
    reason: 'rework',
    prompt: '按验收意见重做。',
    rework: true,
    nonce: 'rework-1',
  }
  const first = await ctx.handoff.trigger(params)
  const again = await ctx.handoff.trigger(params)
  assert.equal(ctx.sent.length, 1)
  assert.equal(again.id, first.id)
})
