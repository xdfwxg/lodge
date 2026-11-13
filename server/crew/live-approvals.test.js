import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveApprovals } from './live-approvals.js'

const setup = trust => {
  let room = {
    id: 'room-1',
    state: 'active',
    trust,
    seatSpecs: [{ id: 'worker', role: 'worker', name: '执行', permissions: { read: true, exec: true, write: true } }],
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
    engine: { answerCard: async input => { answered.push(input); return { ok: true } } },
    emit: () => {},
    approvalTimeoutMs: 60_000,
  })
  const entry = {
    roomId: room.id,
    seats: new Map([['worker', { sessionRef: 'thread-worker' }]]),
    answeredCards: new Set(),
    heldCards: new Map(),
    approvalTimers: new Map(),
  }
  return { approvals, entry, answered, events, messages, room: () => room }
}

test('auto trust only auto-allows external actions the rule gate permits', async () => {
  const ctx = setup('auto')
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'card-1', action: 'exec', tool: 'Bash', subtitle: 'rm tmp.txt' },
  }, () => {})
  assert.equal(ctx.answered[0].behavior, 'allow')
  assert.equal(ctx.room().approvals.length, 0)
  assert.equal(ctx.events[0].type, 'trust.auto_allow')
  assert.match(ctx.messages[0].text, /自动放行/)
})

test('observe trust is read-only', async () => {
  const ctx = setup('observe')
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'card-2', action: 'write', tool: 'Write' },
  }, () => {})
  assert.equal(ctx.answered[0].behavior, 'deny')
  assert.match(ctx.messages[0].text, /observe.*只读/)
})
