import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageProjector } from './live-projection.js'
import { createSeatSync } from './live-sync.js'

test('an engine-level seat error pauses the room and marks its task failed', async () => {
  let room = {
    id: 'room-1',
    state: 'active',
    roomType: 'studio',
    seatBots: { worker: 'bot-w' },
    seatNames: { worker: '执行者' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: '执行者' }],
    hiddenBaseMessages: [],
    stages: [{
      title: 'impl',
      kind: 'deliverable',
      state: 'active',
      acceptance: 'true',
      tasks: [{ owner: 'worker', status: 'working' }],
    }],
  }
  const messages = []
  const store = {
    readRoom: () => room,
    updateRoom: (_id, mutate) => {
      const next = structuredClone(room)
      const result = mutate(next)
      if (result === null) return null
      room = next
      return room
    },
    upsertMessage: message => messages.push(message),
    appendMessage: (_id, message) => messages.push(message),
  }
  const projector = createMessageProjector({ store })
  const sync = createSeatSync({
    store,
    engine: {
      history: async () => ({
        messages: [{ id: 'a1', kind: 'activity', ok: false, authorRef: 'bot-w', text: 'error: 429 {"type":"rate_limit_error","message":"余额不足或无可用资源包"}' }],
      }),
    },
    projector,
  })
  const entry = {
    roomId: 'room-1',
    seats: new Map([['worker', { sessionRef: 's' }]]),
    syncing: new Set(),
    turns: { trackTool: () => {}, captureTurn: () => {} },
  }
  await sync.syncSeat(entry, 'worker')
  assert.equal(room.state, 'paused')
  assert.equal(room.pauseReason, 'seat_error')
  assert.equal(room.seatError.seat, 'worker')
  assert.equal(room.seatError.kind, 'quota')
  assert.equal(room.stages[0].tasks[0].status, 'failed')
  assert.match(messages.at(-1).text, /额度不足/)
  assert.match(messages.at(-1).text, /点“继续”/)
  assert.equal(messages.some(message => /recent-work/.test(message.text ?? '')), false)
})

test('ordinary activity is not treated as an engine failure', async () => {
  let room = {
    id: 'room-1',
    state: 'active',
    roomType: 'studio',
    seatBots: { worker: 'bot-w' },
    seatNames: { worker: '执行者' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: '执行者' }],
    hiddenBaseMessages: [],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  }
  const store = {
    readRoom: () => room,
    updateRoom: (_id, mutate) => {
      const next = structuredClone(room)
      mutate(next)
      room = next
      return room
    },
    upsertMessage: () => {},
    appendMessage: () => {},
  }
  const projector = createMessageProjector({ store })
  const sync = createSeatSync({
    store,
    engine: {
      history: async () => ({
        messages: [{ id: 'a1', kind: 'activity', ok: true, authorRef: 'bot-w', text: 'Bash' }],
      }),
    },
    projector,
  })
  const entry = {
    roomId: 'room-1',
    seats: new Map([['worker', { sessionRef: 's' }]]),
    syncing: new Set(),
    turns: { trackTool: () => {}, captureTurn: () => {} },
  }
  await sync.syncSeat(entry, 'worker')
  assert.equal(room.state, 'active')
})
