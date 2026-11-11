import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateUsage, parseUsageRange } from './usage-history.js'

const day = '2026-11-12T10:00:00.000Z'
const now = Date.parse(day)
const rooms = [
  { id: 'r1', name: '一', usage: { costMicroUsd: 999, turns: 9 } },
  { id: 'r2', name: '二', usage: { costMicroUsd: 500, turns: 5 } },
  { id: 'r3', name: '导入', imported: true, usage: { costMicroUsd: 9999, turns: 9 } },
]

test('usage history aggregates buckets and room totals', () => {
  const history = {
    r1: [
      { at: now, costMicroUsd: 120, turns: 2, tokens: { input: 100, output: 20, cachedInput: 10 } },
      { at: now - 24 * 60 * 60 * 1000, costMicroUsd: 80, turns: 1, tokens: { input: 50, output: 10, cachedInput: 0 } },
    ],
  }
  const usage = aggregateUsage({
    rooms,
    historyOf: room => history[room.id] ?? [],
    range: '7d',
    now,
  })
  assert.equal(usage.range, '7d')
  assert.equal(usage.days, 7)
  assert.equal(usage.totals.costMicroUsd, 120 + 80 + 500)
  assert.equal(usage.totals.turns, 2 + 1 + 5)
  assert.deepEqual(usage.totals.tokens, { input: 150, output: 30, cachedInput: 10 })
  assert.equal(usage.rooms[0].roomId, 'r2')
  assert.equal(usage.buckets.at(-1).costMicroUsd, 620)
})

test('the range is clamped and imported rooms are excluded', () => {
  assert.deepEqual(parseUsageRange('24h'), { id: '24h', days: 1 })
  assert.deepEqual(parseUsageRange('99d'), { id: '90d', days: 90 })
  const usage = aggregateUsage({ rooms, historyOf: () => [], range: '24h', now })
  assert.equal(usage.rooms.some(room => room.roomId === 'r3'), false)
})
