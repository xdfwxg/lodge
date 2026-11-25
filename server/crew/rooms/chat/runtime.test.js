import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatRuntime } from './runtime.js'

const setup = () => {
  const answered = []
  const messages = []
  const room = {
    id: 'room-1',
    roomType: 'chat',
    seatSpecs: [{ id: 'worker', name: '甲' }],
  }
  const strategy = createChatRuntime({
    store: {
      readRoom: () => room,
      appendMessage: (roomId, message) => messages.push(message),
      updateRoom: (_roomId, mutate) => {
        const changed = mutate(room)
        return changed === null ? null : room
      },
      updateRound: (_roomId, mutate) => {
        const changed = mutate(room)
        return changed === null ? null : room
      },
    },
    engine: {
      answerCard: async input => { answered.push(input); return { ok: true } },
    },
    emit: () => {},
    refreshRoom: async () => {},
  })
  return { strategy, answered, messages, room }
}

test('chat usage is written through the round, not the room', () => {
  const room = { id: 'room-1', roomType: 'chat' }
  const strategy = createChatRuntime({
    store: {
      readRoom: () => room,
      appendMessage: () => {},
      updateRoom: () => { throw new Error('usage 是轮次字段，必须走 updateRound') },
      updateRound: (_roomId, mutate) => {
        mutate(room)
        return room
      },
    },
    engine: { answerCard: async () => ({ ok: true }) },
    emit: () => {},
    refreshRoom: async () => {},
  })
  strategy.captureTurn({ roomId: 'room-1' }, {
    turn: { usage: { input: 10, output: 5, costUsd: 0.002 } },
  })
  assert.equal(room.usage.turns, 1)
  assert.equal(room.usage.costMicroUsd, 2000)
})

test('chat turns accumulate room usage without stage diagnostics', () => {
  const { strategy, room } = setup()
  strategy.captureTurn({ roomId: 'room-1' }, {
    turn: { usage: { input: 10, output: 5, costUsd: 0.002 } },
  })
  assert.equal(room.usage.costStatus, 'reported')
  assert.equal(room.usage.costMicroUsd, 2000)
  assert.equal(room.usage.turns, 1)
})

test('a due chat work item resumes the round', async () => {
  const { strategy, room } = setup()
  room.state = 'active'
  room.chat = { running: true, round: 1 }
  const starts = []
  const entry = {
    roomId: 'room-1',
    chatRun: { isRunning: () => false, start: async (_room, options) => { starts.push(options) } },
  }
  assert.equal(await strategy.handleWork(entry, { kind: 'chat.round' }), true)
  assert.deepEqual(starts, [{ resume: true }])

  room.chat = { ...room.chat, running: false }
  assert.equal(await strategy.handleWork(entry, { kind: 'chat.round' }), true)
  assert.equal(starts.length, 1)
})

test('chat allows read-only tools and denies write or exec', async () => {
  const { strategy, answered, messages } = setup()
  await strategy.permissionCard({ roomId: 'room-1' }, 'worker', {
    card: { action: 'read', requestId: 'p1', tool: 'Read' },
  }, { sessionRef: 'thread-1' })
  await strategy.permissionCard({ roomId: 'room-1' }, 'worker', {
    card: { action: 'exec', requestId: 'p2', tool: 'mcp__chrome-devtools__take_snapshot' },
  }, { sessionRef: 'thread-1' })
  await strategy.permissionCard({ roomId: 'room-1' }, 'worker', {
    card: { action: 'write', requestId: 'p3', tool: 'Write' },
  }, { sessionRef: 'thread-1' })
  await strategy.permissionCard({ roomId: 'room-1' }, 'worker', {
    card: { action: 'exec', requestId: 'p4', tool: 'mcp__chrome-devtools__click' },
  }, { sessionRef: 'thread-1' })
  assert.deepEqual(answered.map(item => item.behavior), ['allow', 'allow', 'deny', 'deny'])
  assert.match(messages[0].text, /只放行只读工具/)
})
