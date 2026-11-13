import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_STATES,
  STUDIO_STATES,
  transitionChat,
  transitionStudio,
} from './room-state.js'

test('studio closure only accepts the transitions in the table', () => {
  assert.equal(transitionStudio('open', 'plan_submitted').state, 'planned')
  assert.equal(transitionStudio('open', 'start_execute').state, 'executing')
  assert.equal(transitionStudio('planned', 'start_execute').state, 'executing')
  assert.equal(transitionStudio('planned', 'reject_plan').state, 'rejected')
  assert.equal(transitionStudio('executing', 'submit_evidence', { exitCode: 0 }).state, 'verifying')
  assert.equal(transitionStudio('executing', 'submit_evidence', { manual: true }).state, 'verifying')
  assert.equal(transitionStudio('verifying', 'verdict_pass').state, 'verifying')
  assert.equal(transitionStudio('verifying', 'verdict_reject').state, 'executing')
  assert.equal(transitionStudio('verifying', 'stage_advanced').state, 'planned')
  assert.equal(transitionStudio('verifying', 'sign', { verdictPassed: true, human: true }).state, 'signed')
  assert.equal(transitionStudio('planned', 'sign', { verdictPassed: true, human: true }).state, 'signed')
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
