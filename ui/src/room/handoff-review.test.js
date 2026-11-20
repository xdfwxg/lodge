import assert from 'node:assert/strict'
import test from 'node:test'
import { gateCardState } from './handoff-review.js'

test('a clean handoff with manual review can start', () => {
  assert.deepEqual(gateCardState({ needsReview: false, reviewed: false }), {
    ready: true,
    status: '可以开工',
    pendingText: null,
  })
})

test('open disagreements keep the card pending until reviewed', () => {
  assert.equal(gateCardState({ needsReview: true, reviewed: false }).status, '有分歧')
  assert.equal(gateCardState({ needsReview: true, reviewed: true }).status, '可以开工')
})

test('a command check needs a command unless every stage has one', () => {
  assert.equal(gateCardState({ needsReview: false, reviewed: false, verify: 'test', acceptance: '' }).status, '还差一条检查')
  assert.equal(gateCardState({
    needsReview: false,
    reviewed: false,
    verify: 'test',
    acceptance: 'npm test',
  }).status, '可以开工')
  assert.equal(gateCardState({
    needsReview: false,
    reviewed: false,
    verify: 'test',
    acceptance: '',
    plannedAcceptance: true,
  }).status, '可以开工')
})
