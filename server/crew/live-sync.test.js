import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageProjector } from './kernel/live/projection.js'
import { createMemberSync } from './kernel/live/sync.js'
import { normalizeLegacyTestRoom, withAssignments } from './testing/room.js'

test('an engine-level member error pauses the room and marks its assignment failed', async () => {
  let room = normalizeLegacyTestRoom({
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
    }],
  })
  const messages = []
  const store = withAssignments({
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
  })
  store.writeAssignment({
    id: 'as-1',
    roomId: 'room-1',
    stageIndex: 0,
    fromMemberId: 'lead',
    toMemberId: 'worker',
    reason: 'dispatch',
    brief: {},
    status: 'working',
    context: { parallel: true },
    flags: {},
  })
  const projector = createMessageProjector({ store })
  const sync = createMemberSync({
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
    members: new Map([['worker', { sessionRef: 's' }]]),
    syncing: new Set(),
    turns: { trackTool: () => {}, captureTurn: () => {} },
  }
  await sync.syncMember(entry, 'worker')
  assert.equal(room.state, 'paused')
  assert.equal(room.pauseReason, 'member_error')
  assert.equal(room.memberError.memberId, 'worker')
  assert.equal(room.memberError.kind, 'quota')
  assert.equal(store.readAssignment('as-1').status, 'failed')
  assert.match(messages.at(-1).text, /模型额度不够/)
  assert.match(messages.at(-1).text, /点“继续”/)
  assert.equal(messages.some(message => /recent-work/.test(message.text ?? '')), false)
})

test('ordinary activity is not treated as an engine failure', async () => {
  let room = normalizeLegacyTestRoom({
    id: 'room-1',
    state: 'active',
    roomType: 'studio',
    seatBots: { worker: 'bot-w' },
    seatNames: { worker: '执行者' },
    seatSpecs: [{ id: 'worker', role: 'worker', name: '执行者' }],
    hiddenBaseMessages: [],
    stages: [{ title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'true' }],
  })
  const store = withAssignments({
    readRoom: () => room,
    updateRoom: (_id, mutate) => {
      const next = structuredClone(room)
      mutate(next)
      room = next
      return room
    },
    upsertMessage: () => {},
    appendMessage: () => {},
  })
  const projector = createMessageProjector({ store })
  const sync = createMemberSync({
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
    members: new Map([['worker', { sessionRef: 's' }]]),
    syncing: new Set(),
    turns: { trackTool: () => {}, captureTurn: () => {} },
  }
  await sync.syncMember(entry, 'worker')
  assert.equal(room.state, 'active')
})
