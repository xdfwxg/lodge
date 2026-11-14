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
    },
    engine: {
      answerCard: async input => { answered.push(input); return { ok: true } },
    },
    emit: () => {},
    refreshRoom: async () => {},
  })
  return { strategy, answered, messages }
}

test('chat allows read-only tools and denies write or exec', async () => {
  const { strategy, answered, messages } = setup()
  await strategy.permissionCard({ roomId: 'room-1' }, 'worker', {
    card: { action: 'read', requestId: 'p1', tool: 'Read' },
  }, { sessionRef: 'thread-1' })
  await strategy.permissionCard({ roomId: 'room-1' }, 'worker', {
    card: { action: 'write', requestId: 'p2', tool: 'Write' },
  }, { sessionRef: 'thread-1' })
  assert.deepEqual(answered.map(item => item.behavior), ['allow', 'deny'])
  assert.match(messages[0].text, /只放行只读工具/)
})
