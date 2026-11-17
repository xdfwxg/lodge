import assert from 'node:assert/strict'
import test from 'node:test'
import { presentRoom } from './presentation.js'

test('room presentation hides base fields and keeps the display host label', () => {
  const room = {
    id: 'room-1',
    state: 'active',
    roomType: 'chat',
    chatRoom: { id: 'base-room', sessionRef: 'session-1' },
    chatHost: { memberRef: 'base-host', name: 'LodgeHost1', displayName: 'Lodge 主持' },
    hiddenBaseMessages: ['base-message'],
    members: [{
      id: 'worker',
      name: '甲',
      body: { kind: 'base', ref: 'base-member', roomRef: 'base-room', sessionRef: 'session-1', engine: 'pi', model: 'deepseek' },
    }],
    stages: [],
  }
  const presented = presentRoom(room, [])
  assert.equal(presented.chatRoom, undefined)
  assert.equal(presented.chatHost, undefined)
  assert.equal(presented.hiddenBaseMessages, undefined)
  assert.equal(presented.hostLabel, 'Lodge 主持')
  assert.deepEqual(presented.members[0].body, { kind: 'base', engine: 'pi', model: 'deepseek' })
})

test('a studio room never exposes a chat host', () => {
  const room = {
    id: 'room-studio',
    state: 'active',
    roomType: 'studio',
    chatHost: { memberRef: 'base-host', name: 'LodgeHost1', displayName: 'Lodge 主持' },
    members: [],
    stages: [],
  }
  const presented = presentRoom(room, [])
  assert.equal(presented.chatHost, undefined)
  assert.equal(presented.hostLabel, '')
})

test('room events and state share one projected status and independence label', () => {
  const room = {
    id: 'room-1',
    state: 'active',
    busy: false,
    verifiers: [],
    openQuestion: null,
    independence: 'human',
    stages: [{ title: 'docs', kind: 'decision', state: 'active' }],
  }
  const presented = presentRoom(room, [])
  assert.deepEqual(presented.needsYou, { kind: 'decision', stage: 0, label: '待确认' })
  assert.equal(presented.independenceLabel, '你签字验收')
  assert.deepEqual(presented.capabilities, { dispatch: false })
  assert.equal(room.needsYou, undefined, 'projection does not mutate the stored room')
})
