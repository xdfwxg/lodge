import test from 'node:test'
import assert from 'node:assert/strict'
import { retireRoomResources } from './retire.js'

test('retiring a room removes member bodies, the host and the chat group', async () => {
  const calls = []
  const engine = {
    deleteRoom: async id => { calls.push(`group:${id}`) },
    deleteMemberBot: async id => { calls.push(`bot:${id}`) },
  }
  await retireRoomResources({
    engine,
    room: {
      members: [
        { body: { ref: 'bot-a', roomRef: 'group-a' } },
        { body: { ref: 'bot-b', roomRef: 'group-b' } },
      ],
      chatHost: { memberRef: 'bot-host' },
      chatRoom: { id: 'group-chat' },
    },
  })
  assert.deepEqual(calls.sort(), [
    'bot:bot-a',
    'bot:bot-b',
    'bot:bot-host',
    'group:group-a',
    'group:group-b',
    'group:group-chat',
  ])
})

test('a room without a chat group still retires its members', async () => {
  const calls = []
  await retireRoomResources({
    engine: {
      deleteRoom: async id => { calls.push(`group:${id}`) },
      deleteMemberBot: async id => { calls.push(`bot:${id}`) },
    },
    room: { members: [{ body: { ref: 'bot-a', roomRef: 'group-a' } }] },
  })
  assert.deepEqual(calls.sort(), ['bot:bot-a', 'group:group-a'])
})
