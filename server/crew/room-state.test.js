import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_EVENTS, CHAT_STATES, transitionChat } from './rooms/chat/state.js'

test('chat rooms conclude without asking for a signoff', () => {
  assert.equal(transitionChat('discussing', 'summarize').state, 'summarizing')
  assert.equal(transitionChat('summarizing', 'conclude').state, 'concluded')
  assert.equal(transitionChat('concluded', 'continue_discuss').state, 'discussing')
  assert.deepEqual(CHAT_STATES.includes('closed'), false)
})

test('the full chat state x event matrix is explicit', () => {
  const allowed = new Set([
    'discussing:summarize', 'discussing:abort',
    'summarizing:conclude', 'summarizing:abort',
    'concluded:continue_discuss',
  ])
  for (const state of CHAT_STATES) {
    for (const event of CHAT_EVENTS) {
      const result = transitionChat(state, event)
      assert.equal(result.ok, allowed.has(`${state}:${event}`), `${state} + ${event}`)
    }
  }
})
