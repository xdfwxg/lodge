import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveApprovals } from './kernel/live/approvals.js'

const setup = trust => {
  let room = {
    id: 'room-1',
    state: 'active',
    trust,
    members: [{ id: 'worker', role: 'worker', roleKind: 'executor', name: '执行', permissions: { read: true, exec: true, write: true }, toolSurface: [], skills: [], mcp: [], body: { kind: 'base', ref: 'bot-worker', name: '执行' } }],
    stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'true' }],
    approvals: [],
  }
  const answered = []
  const events = []
  const messages = []
  const store = {
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const next = structuredClone(room)
      if (mutate(next) === null) return null
      room = next
      return room
    },
    appendEvent: (id, type, payload) => events.push({ type, payload }),
    appendMessage: (id, message) => messages.push(message),
  }
  const approvals = createLiveApprovals({
    store,
    engine: {
      capabilities: () => ({ approvals: true }),
      answerCard: async input => { answered.push(input); return { ok: true } },
    },
    emit: () => {},
    approvalTimeoutMs: 60_000,
  })
  const entry = {
    roomId: room.id,
    members: new Map([['worker', { sessionRef: 'thread-worker' }]]),
    answeredCards: new Set(),
    heldCards: new Map(),
    approvalTimers: new Map(),
  }
  return { approvals, entry, answered, events, messages, room: () => room }
}

test('a question card is answered once in the member thread', async () => {
  const ctx = setup('verify')
  const result = await ctx.approvals.answerCard({
    entry: ctx.entry,
    roomId: 'room-1',
    memberId: 'worker',
    requestId: 'q1',
    message: '选 A',
    refresh: () => {},
  })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.answered[0], {
    sessionRef: 'thread-worker',
    requestId: 'q1',
    behavior: 'answer',
    message: '选 A',
  })
  assert.equal(ctx.entry.answeredCards.has('q1'), true)
  const again = await ctx.approvals.answerCard({
    entry: ctx.entry,
    roomId: 'room-1',
    memberId: 'worker',
    requestId: 'q1',
    message: '选 B',
    refresh: () => {},
  })
  assert.equal(again.ok, false)
  assert.equal(ctx.answered.length, 1)
})

