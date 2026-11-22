import assert from 'node:assert/strict'
import test from 'node:test'
import { roundAtOf, turnStartOf } from './kernel/live/bus.js'

test('a late message belongs to the round its turn started in', () => {
  const room = {
    rounds: [
      { id: 'round-1', startedAt: 100, completedAt: 199 },
      { id: 'round-2', startedAt: 200, completedAt: null },
    ],
  }
  const late = { at: 260, turn: { durationMs: 100 } }
  assert.equal(turnStartOf(late), 160)
  assert.equal(roundAtOf(room, turnStartOf(late)), 'round-1')
  // 基座的 from.since 是回合开始时间；迟到的上一轮回复靠它归回上一轮。
  assert.equal(turnStartOf({ at: 260, from: { since: 150 } }), 150)
  assert.equal(roundAtOf(room, turnStartOf({ at: 260, from: { since: 150 } })), 'round-1')
  assert.equal(roundAtOf(room, turnStartOf({ at: 320, durationMs: 20 })), 'round-2')
  assert.equal(roundAtOf(room, turnStartOf({ at: 90, durationMs: 10 })), undefined)
})

test('a message without a turn start keeps the current round fallback', () => {
  assert.equal(turnStartOf({}), null)
  assert.equal(roundAtOf({}, 100), undefined)
})
