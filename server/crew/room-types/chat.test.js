import assert from 'node:assert/strict'
import test from 'node:test'
import { requestedTurnLimitOf } from './chat.js'

test('a chat round can take its turn count from the user instruction', () => {
  assert.equal(requestedTurnLimitOf('讨论三次'), 3)
  assert.equal(requestedTurnLimitOf('重新讨论5轮'), 5)
  assert.equal(requestedTurnLimitOf('再来3次'), 3)
  assert.equal(requestedTurnLimitOf('再聊两轮'), 2)
  assert.equal(requestedTurnLimitOf('讨论一遍'), 1)
  assert.equal(requestedTurnLimitOf('20个字讨论一遍'), 1)
  assert.equal(requestedTurnLimitOf('讨论十二次'), 12)
  assert.equal(requestedTurnLimitOf('讨论二十次'), 20)
})

test('a turn request is capped and never inferred from ordinary chat', () => {
  assert.equal(requestedTurnLimitOf('讨论九十九次'), 20)
  assert.equal(requestedTurnLimitOf('再聊聊这个观点'), null)
  assert.equal(requestedTurnLimitOf('讨论一下'), null)
})
