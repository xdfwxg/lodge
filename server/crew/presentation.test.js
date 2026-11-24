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
    verifiers: ['verifier'],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', body: { kind: 'base', ref: 'bot-v', name: 'V' } }],
    openQuestion: null,
    independence: 'human',
    stages: [{ title: 'docs', kind: 'deliverable', state: 'active', deliverable: '写一份说明' }],
  }
  const messages = [
    { id: 'e-1', kind: 'evidence', seq: 1, meta: { stage: 0, kind: 'result' } },
    { id: 'v-1', kind: 'verdict', authorId: 'verifier', seq: 2, meta: { stage: 0, pass: true, evidenceId: 'e-1' } },
  ]
  const presented = presentRoom(room, messages)
  assert.deepEqual(presented.needsYou, { kind: 'signoff', stage: 0, label: '', actionable: false })
  assert.equal(presented.independenceLabel, '你来确认')
  assert.deepEqual(presented.capabilities, { dispatch: false })
  assert.equal(room.needsYou, undefined, 'projection does not mutate the stored room')
})
