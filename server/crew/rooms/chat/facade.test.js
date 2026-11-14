import assert from 'node:assert/strict'
import test from 'node:test'
import { chatFacade } from './facade.js'

test('the chat facade exposes only whether the chat is running', () => {
  assert.equal(chatFacade.runningOf({ chat: { running: true } }), true)
  assert.equal(chatFacade.runningOf({ chat: { running: false } }), false)
  assert.equal(chatFacade.runningOf({}), false)
})
