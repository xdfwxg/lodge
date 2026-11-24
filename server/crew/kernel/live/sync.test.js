import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemberSync } from './sync.js'

test('a chat member without a turn tracker can still sync history', async () => {
  const entry = {
    roomId: 'room-chat',
    syncing: new Set(),
    members: new Map([['member-1', { sessionRef: 'thread-1' }]]),
  }
  const sync = createMemberSync({
    store: { upsertMessage: () => {}, appendMessage: () => {} },
    engine: {
      history: async () => ({
        messages: [{ id: 'm1', kind: 'turn', authorRef: 'member-1', turn: { reply: '我在。' } }],
      }),
    },
    projector: { toStored: () => null },
  })
  await sync.syncMember(entry, 'member-1')
  assert.equal(entry.syncing.has('member-1'), false)
})
