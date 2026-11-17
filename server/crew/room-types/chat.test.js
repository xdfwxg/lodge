import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_TURNS_PER_ROUND, turnLimitOf } from './chat.js'

test('a chat room keeps the fixed turn limit chosen when it was created', () => {
  assert.equal(turnLimitOf({ chat: { turnLimit: 3 } }), 3)
  assert.equal(turnLimitOf({ chat: { turnLimit: 7 } }), 7)
})

test('a missing or invalid turn limit falls back to the room default', () => {
  assert.equal(turnLimitOf({}), CHAT_TURNS_PER_ROUND)
  assert.equal(turnLimitOf({ chat: { turnLimit: 0 } }), CHAT_TURNS_PER_ROUND)
  assert.equal(turnLimitOf({ chat: { turnLimit: 99 } }), CHAT_TURNS_PER_ROUND)
})
