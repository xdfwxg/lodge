import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveApprovals } from './kernel/live/approvals.js'

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
    engine: {
      capabilities: () => ({ approvals: true }),
      answerCard: async input => { answered.push(input); return { ok: true } },
    },
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

