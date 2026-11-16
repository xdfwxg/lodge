import assert from 'node:assert/strict'
import test from 'node:test'
import { heldMessageCountsOf, heldMembersOf, memberQueueOf, memberActivityOf } from './member-activity.js'

const toMember = ref => ({ 'bot-a': 'lead', 'bot-b': 'worker', 'bot-c': 'verifier' }[ref] ?? ref)

test('the base queue maps onto member ids and keeps waiting order', () => {
  const queue = memberQueueOf({
    toMember,
    queue: [
      { memberRef: 'bot-b', state: 'queued', position: 2, of: 2, waitingForRef: 'bot-a' },
      { memberRef: 'bot-a', state: 'running', position: 1, of: 2 },
    ],
  })
  assert.deepEqual(queue, [
    { memberId: 'lead', state: 'running', position: 1, of: 2 },
    { memberId: 'worker', state: 'queued', position: 2, of: 2, waitingForMemberId: 'lead' },
  ])
})

test('a member repeated in the queue is kept once, running wins', () => {
  const queue = memberQueueOf({
    toMember,
    queue: [
      { memberRef: 'bot-b', state: 'queued', position: 2, of: 2 },
      { memberRef: 'bot-b', state: 'running', position: 1, of: 2 },
    ],
  })
  assert.deepEqual(queue, [{ memberId: 'worker', state: 'running', position: 1, of: 2 }])
})

test('empty or unmapped queues produce nothing', () => {
  assert.deepEqual(memberQueueOf(), [])
  assert.deepEqual(memberQueueOf({ queue: [], toMember }), [])
})

test('the shared projection publishes the queue and holds', () => {
  const out = memberActivityOf({
    queue: [
      { memberRef: 'bot-a', state: 'running', position: 1, of: 2 },
      { memberRef: 'bot-c', state: 'queued', position: 2, of: 2, waitingForRef: 'bot-a' },
    ],
    holds: { 'bot-b': { at: 1 } },
    heldMessages: { 'bot-b': [{ threadId: 't1', messageId: 'm1' }, { threadId: 't1', messageId: 'm2' }] },
  }, toMember)
  assert.deepEqual(out.turnQueue.map(item => [item.memberId, item.state]), [['lead', 'running'], ['verifier', 'queued']])
  assert.deepEqual(out.heldMembers, ['worker'])
  assert.deepEqual(out.heldMessages, { worker: 2 })
})

test('holds map onto members and ignore unknown members', () => {
  assert.deepEqual(heldMembersOf({ toMember, holds: { 'bot-a': { at: 1 }, 'bot-x': { at: 2 } } }), ['lead', 'bot-x'])
  assert.deepEqual(heldMembersOf({ toMember }), [])
})

test('held messages count per member and drop empty members', () => {
  assert.deepEqual(
    heldMessageCountsOf({
      toMember,
      heldMessages: {
        'bot-a': [{ messageId: 'm1' }],
        'bot-b': [],
        'bot-x': [{ messageId: 'm2' }],
      },
    }),
    { lead: 1, 'bot-x': 1 },
  )
})
