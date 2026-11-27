import assert from 'node:assert/strict'
import test from 'node:test'
import { createStuckAudit } from './stuck-audit.js'

const room = ({ id = 'room-1', stuck = true, kind = 'studio' } = {}) => ({
  id,
  roomType: kind,
  state: 'active',
  lastProgressAt: 1_000,
  stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
  assignments: stuck ? [] : [{ stageIndex: 0, status: 'working' }],
  approvals: [],
})

const storeOf = (rooms, assignments = {}) => {
  const events = []
  return {
    readRooms: () => rooms,
    readAssignments: roomId => assignments[roomId] ?? [],
    appendEvent: (roomId, type, payload) => { events.push({ roomId, type, payload }) },
    events,
  }
}

test('a room with an active stage and nothing in flight is reported once per episode', () => {
  const store = storeOf([room()])
  const logs = []
  const audit = createStuckAudit({ store, now: () => 10_000_000, warn: message => logs.push(message) })
  assert.equal(audit.audit().length, 1)
  assert.equal(store.events.length, 1)
  assert.equal(store.events[0].type, 'state.violation')
  assert.match(logs[0], /没有任何在跑或等人的交接/)
  // 同一段卡住不刷屏；房间恢复后再卡住，可以再报一次。
  audit.audit()
  assert.equal(store.events.length, 1)
  store.readRooms = () => [room({ stuck: false })]
  audit.audit()
  assert.equal(audit.reported.size, 0)
})

test('a stuck audit only looks at live studio rooms', () => {
  const store = storeOf([room({ kind: 'chat' }), room({ id: 'room-2', stuck: false })])
  const audit = createStuckAudit({ store, now: () => 10_000_000, warn: () => {} })
  assert.deepEqual(audit.audit(), [])
  assert.equal(store.events.length, 0)
})

test('a review in flight is not a dead room, even though the room snapshot has no assignments', () => {
  const store = storeOf([room()], { 'room-1': [{ stageIndex: 0, status: 'sent' }] })
  const audit = createStuckAudit({ store, now: () => 10_000_000, warn: () => {} })
  assert.deepEqual(audit.audit(), [])
  assert.equal(store.events.length, 0)
})
