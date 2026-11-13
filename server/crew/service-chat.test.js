import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceChat } from './service-chat.js'

const setup = () => {
  let current = {
    id: 'room-chat',
    kind: 'room',
    roomType: 'chat',
    engine: 'chat',
    state: 'active',
    live: true,
    usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
    chat: {
      round: 1,
      phase: 'awaiting_decision',
      turns: 6,
      conclusionId: 'c-1',
      accepted: false,
      running: false,
      speaker: '',
      note: '',
    },
  }
  const messages = []
  const calls = []
  const store = {
    readMessages: () => messages,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m-${messages.length + 1}`, seq: messages.length + 1, ...message }
      messages.push(stored)
      return stored
    },
  }
  const chat = createServiceChat({
    store,
    live: {
      isAttached: () => true,
      continueChat: async (room, note) => { calls.push({ roomId: room.id, note }) },
    },
    emit: () => {},
    dispatchPayload: () => null,
  })
  return { chat, room: () => current, messages, calls }
}

test('accepting a chat conclusion completes the room without stages', () => {
  const ctx = setup()
  const result = ctx.chat.accept(ctx.room())
  assert.equal(result.ok, true)
  assert.equal(ctx.room().state, 'complete')
  assert.equal(ctx.room().chat.accepted, true)
  assert.equal(ctx.room().chat.running, false)
  assert.equal(ctx.messages.at(-1).kind, 'system')
})

test('rejecting a chat conclusion starts another round', async () => {
  const ctx = setup()
  const result = ctx.chat.continue(ctx.room(), { note: '还缺反方观点' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().chat.round, 2)
  assert.equal(ctx.room().chat.running, true)
  assert.equal(ctx.room().chat.phase, 'discussing')
  assert.equal(ctx.room().chat.conclusionId, null)
  assert.equal(ctx.messages.at(-1).kind, 'chat_rework')
  assert.equal(ctx.messages.at(-1).text, '还缺反方观点')
  assert.deepEqual(ctx.calls, [{ roomId: 'room-chat', note: '还缺反方观点' }])
})
