import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_TURNS_PER_ROUND, turnLimitOf } from './chat.js'

test('a chat room can lower the per-round cap but never raise it', () => {
  assert.equal(turnLimitOf({ chat: { turnLimit: 3 } }), 3)
  assert.equal(turnLimitOf({ chat: { turnLimit: 7 } }), CHAT_TURNS_PER_ROUND)
})

test('a missing or invalid turn limit falls back to the room default', () => {
  assert.equal(turnLimitOf({}), CHAT_TURNS_PER_ROUND)
  assert.equal(turnLimitOf({ chat: { turnLimit: 0 } }), CHAT_TURNS_PER_ROUND)
  assert.equal(turnLimitOf({ chat: { turnLimit: 99 } }), CHAT_TURNS_PER_ROUND)
})
