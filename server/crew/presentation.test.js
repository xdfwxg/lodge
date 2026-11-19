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

test('a routine run that needs you is presented on the goal room', () => {
  const members = [{ id: 'worker', name: '执行官', role: 'worker', roleKind: 'executor', permissions: {} }]
  const goal = {
    id: 'goal',
    state: 'complete',
    roomType: 'studio',
    members,
    stages: [],
    routine: { days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0, enabled: true, lastRoomId: 'run-1' },
  }
  const run = {
    id: 'run-1',
    state: 'paused',
    roomType: 'studio',
    members,
    stages: [],
    pauseReason: 'member_error',
    memberError: { memberId: 'worker', kind: 'auth' },
  }
  const presented = presentRoom(goal, [], [], { routineRun: { room: run, messages: [] } })
  assert.equal(presented.needsYou.kind, 'routine-run')
  assert.equal(presented.needsYou.reason, '执行官的登录失效了')
  assert.equal(presented.needsYou.runId, 'run-1')
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

test('a subroom that waits on you is listed next to this room', () => {
  const child = {
    id: 'child-1',
    name: '写欢迎语',
    state: 'active',
    stages: [{ title: 'welcome', kind: 'decision', state: 'active' }],
  }
  const room = {
    id: 'room-1',
    state: 'active',
    busy: false,
    openQuestion: null,
    stages: [{ title: 'docs', kind: 'decision', state: 'active' }],
    childRoomIds: ['child-1'],
  }
  const presented = presentRoom(room, [], [], { children: [{ room: child, messages: [] }] })
  assert.equal(presented.attention.length, 2)
  assert.equal(presented.needsYou.label, '待确认')
  assert.equal(presented.attention[1].roomId, 'child-1')
  assert.equal(presented.attention[1].roomName, '写欢迎语')
})
