import assert from 'node:assert/strict'
import test from 'node:test'
import { messageOrderOf } from './message-order.js'

test('messages sort by append order even when their timestamps disagree', () => {
  const activity = { kind: 'activity', seq: 390, ts: 1_000 }
  const handoff = { kind: 'system', seq: 389, ts: 1_057 }
  assert.deepEqual([activity, handoff].sort((a, b) => messageOrderOf(a) - messageOrderOf(b)), [handoff, activity])
})

test('a local message without a sequence stays after stored messages', () => {
  const stored = { seq: 500, ts: 9_000 }
  const local = { ts: 1_000 }
  assert.ok(messageOrderOf(local) > messageOrderOf(stored))
})

test('messages without any sequence keep timestamp order', () => {
  const early = { ts: 1_000 }
  const late = { ts: 2_000 }
  assert.ok(messageOrderOf(early) < messageOrderOf(late))
})
