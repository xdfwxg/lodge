import assert from 'node:assert/strict'
import test from 'node:test'
import { PEEK_MS, initialIslandState, peekRemaining, reduceIsland } from './island-machine.js'

const decision = { key: 'decision:signoff:1', kind: 'decision', title: '等你签字' }
const milestone = { key: 'msg:2', kind: 'milestone', title: '第 2 步通过' }

const start = { ...initialIslandState }

test('a milestone peeks and expires on its own', () => {
  const peek = reduceIsland(start, { type: 'snapshot', milestone, now: 1000 })
  assert.equal(peek.mode, 'peek')
  assert.equal(peek.signal.key, 'msg:2')
  assert.equal(peek.expiresAt, 1000 + PEEK_MS)
  assert.equal(peekRemaining(peek.expiresAt, 1500), PEEK_MS - 500)
  assert.equal(reduceIsland(peek, { type: 'elapse', key: 'msg:2' }).mode, 'closed')
  assert.equal(reduceIsland(peek, { type: 'elapse', key: 'other' }).mode, 'peek')
})

test('a decision beats a milestone and never auto-collapses', () => {
  const next = reduceIsland(start, { type: 'snapshot', decision, milestone, now: 1000 })
  assert.equal(next.mode, 'decision')
  assert.equal(next.signal.key, decision.key)
  assert.equal(reduceIsland(next, { type: 'elapse', key: decision.key }).mode, 'decision')
})

test('opening the panel clears the signal, closing returns to the decision', () => {
  const waiting = reduceIsland(start, { type: 'snapshot', decision, now: 1000 })
  const open = reduceIsland(waiting, { type: 'open' })
  assert.equal(open.mode, 'open')
  assert.equal(open.signal, null)
  const closed = reduceIsland(open, { type: 'close', decision })
  assert.equal(closed.mode, 'decision')
  assert.equal(closed.signal.key, decision.key)
})

test('dismissing a decision keeps it dismissed until the decision changes', () => {
  const waiting = reduceIsland(start, { type: 'snapshot', decision, now: 1000 })
  const dismissed = reduceIsland(waiting, { type: 'dismiss' })
  assert.equal(dismissed.mode, 'closed')
  assert.equal(dismissed.dismissed, decision.key)
  const same = reduceIsland(dismissed, { type: 'snapshot', decision, now: 2000 })
  assert.equal(same.mode, 'closed')
  const changed = reduceIsland(same, {
    type: 'snapshot',
    decision: { ...decision, key: 'decision:signoff:2' },
    now: 3000,
  })
  assert.equal(changed.mode, 'decision')
})

test('a resolved decision returns the island to closed', () => {
  const waiting = reduceIsland(start, { type: 'snapshot', decision, now: 1000 })
  const resolved = reduceIsland(waiting, { type: 'snapshot', decision: null, now: 2000 })
  assert.equal(resolved.mode, 'closed')
  assert.equal(resolved.signal, null)
})

test('resuming a paused peek restores the remaining time', () => {
  const peek = reduceIsland(start, { type: 'snapshot', milestone, now: 1000 })
  const resumed = reduceIsland(peek, { type: 'resume', now: 2000, remaining: 1200 })
  assert.equal(resumed.expiresAt, 2000 + 1200)
})

test('a room reset clears everything', () => {
  const waiting = reduceIsland(start, { type: 'snapshot', decision, now: 1000 })
  assert.deepEqual(reduceIsland(waiting, { type: 'reset' }), initialIslandState)
})
