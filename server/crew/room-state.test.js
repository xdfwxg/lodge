import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_STATES,
  STUDIO_STATES,
  CHAT_EVENTS,
  STUDIO_EVENTS,
  transitionChat,
  transitionStudio,
  studioTransitionEvent,
} from './room-state.js'

test('studio closure only accepts the transitions in the table', () => {
  assert.equal(transitionStudio('open', 'plan_submitted').state, 'planned')
  assert.equal(transitionStudio('open', 'start_execute', { hasPlan: false }).state, 'executing')
  assert.equal(transitionStudio('open', 'start_execute', { hasPlan: true }).ok, false)
  assert.equal(transitionStudio('planned', 'start_execute').state, 'executing')
  assert.equal(transitionStudio('planned', 'reject_plan').state, 'rejected')
  assert.equal(transitionStudio('executing', 'submit_evidence', { exitCode: 0 }).state, 'verifying')
  assert.equal(transitionStudio('executing', 'submit_evidence', { manual: true }).state, 'verifying')
  assert.equal(transitionStudio('verifying', 'verdict_pass').state, 'verifying')
  assert.equal(transitionStudio('verifying', 'verdict_reject').state, 'executing')
  assert.equal(transitionStudio('verifying', 'stage_advanced').state, 'planned')
  assert.equal(transitionStudio('planned', 'await_sign').state, 'verifying')
  assert.equal(transitionStudio('verifying', 'sign', { verdictPassed: true, human: true }).state, 'signed')
})

test('studio guards block the architecture red lines', () => {
  assert.equal(transitionStudio('executing', 'reject_plan').ok, false)
  assert.equal(transitionStudio('open', 'reject_plan').ok, false)
  assert.equal(transitionStudio('verifying', 'reject_plan').ok, false)
  assert.equal(transitionStudio('executing', 'submit_evidence', { exitCode: 1 }).ok, false)
  assert.equal(transitionStudio('verifying', 'sign', { verdictPassed: false, human: true }).ok, false)
  assert.equal(transitionStudio('verifying', 'sign', { verdictPassed: true, human: false }).ok, false)
  assert.equal(transitionStudio('signed', 'verdict_reject').ok, false)
  assert.equal(transitionStudio('rejected', 'start_execute').ok, false)
  assert.equal(transitionStudio('executing', 'verdict_pass').ok, false)
})

test('chat rooms move only between the four chat states', () => {
  assert.equal(transitionChat('discussing', 'summarize').state, 'summarizing')
  assert.equal(transitionChat('summarizing', 'conclude').state, 'awaiting_decision')
  assert.equal(transitionChat('awaiting_decision', 'accept').state, 'accepted')
  assert.equal(transitionChat('awaiting_decision', 'continue_discuss').state, 'discussing')
  assert.equal(transitionChat('accepted', 'continue_discuss').ok, false)
  assert.equal(transitionChat('accepted', 'summarize').ok, false)
  assert.deepEqual(CHAT_STATES.includes('closed'), false)
  assert.deepEqual(STUDIO_STATES.includes('verifying'), true)
})

test('the full studio state x event matrix is explicit', () => {
  const allowed = new Set([
    'open:plan_submitted', 'open:start_execute', 'open:stage_advanced', 'open:await_sign',
    'planned:start_execute', 'planned:reject_plan', 'planned:stage_advanced', 'planned:await_sign',
    'executing:stage_advanced', 'executing:await_sign', 'executing:submit_evidence',
    'verifying:verdict_pass', 'verifying:verdict_reject', 'verifying:stage_advanced', 'verifying:await_sign', 'verifying:sign',
  ])
  const context = { manual: true, exitCode: 0, hasPlan: false, verdictPassed: true, human: true }
  for (const state of STUDIO_STATES) {
    for (const event of STUDIO_EVENTS) {
      const result = transitionStudio(state, event, context)
      assert.equal(result.ok, allowed.has(`${state}:${event}`), `${state} + ${event}`)
    }
  }
})

test('the full chat state x event matrix is explicit', () => {
  const allowed = new Set([
    'discussing:summarize',
    'summarizing:conclude',
    'awaiting_decision:accept', 'awaiting_decision:continue_discuss',
  ])
  for (const state of CHAT_STATES) {
    for (const event of CHAT_EVENTS) {
      const result = transitionChat(state, event)
      assert.equal(result.ok, allowed.has(`${state}:${event}`), `${state} + ${event}`)
    }
  }
})

test('transition audit records include reason and actor', () => {
  const moved = transitionStudio('planned', 'reject_plan')
  const event = studioTransitionEvent(moved, 'reject_plan', 'planner', {}, '目标不可行')
  assert.deepEqual(event.payload, {
    from: 'planned', to: 'rejected', event: 'reject_plan', actor: 'planner', reason: '目标不可行',
  })
})
