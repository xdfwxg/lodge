import assert from 'node:assert/strict'
import test from 'node:test'
import { chatTurnLimitFor, initialChatState, turnLimitOf } from './chat.js'

test('a round defaults to tonight’s people plus two', () => {
  assert.equal(chatTurnLimitFor(3), 5)
  assert.equal(chatTurnLimitFor(6), 8)
  assert.equal(chatTurnLimitFor(0), 2)
})

test('a stored limit is read as is; a missing one is null', () => {
  assert.equal(turnLimitOf({ chat: { turnLimit: 3 } }), 3)
  assert.equal(turnLimitOf({}), null)
  assert.equal(turnLimitOf({ chat: { turnLimit: 0 } }), null)
})

test('a new chat room starts without a fixed turn limit', () => {
  assert.equal(initialChatState().turnLimit, null)
})
