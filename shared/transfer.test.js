import assert from 'node:assert/strict'
import test from 'node:test'
import { transferOf } from './transfer.js'

const handoffBrief = { topic: '发布前检查', consensus: [], disagreements: [], constraints: [], todos: [] }
const receipt = { result: '发布前检查清单', completeness: '3/3', checks: [], openQuestions: [] }

test('a handoff brief records where the room came from', () => {
  const transfer = transferOf({ handoffBrief, fromRoomId: 'room-a', fromRoomName: '圆桌', at: 7 })
  assert.deepEqual(transfer, {
    kind: 'handoff',
    fromRoomId: 'room-a',
    fromRoomName: '圆桌',
    at: 7,
  })
})

test('a receipt records the delivery it came from', () => {
  const transfer = transferOf({ receipt, fromRoomId: 'room-b', fromRoomName: '发布检查', at: 9 })
  assert.equal(transfer.kind, 'receipt')
  assert.equal(transfer.fromRoomId, 'room-b')
})

test('a room without a payload has no transfer record', () => {
  assert.equal(transferOf({}), null)
  assert.equal(transferOf({ fromRoomId: 'room-a' }), null)
})
