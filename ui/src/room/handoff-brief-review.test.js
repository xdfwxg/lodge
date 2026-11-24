import assert from 'node:assert/strict'
import test from 'node:test'
import { gateCardState } from './handoff-brief-review.js'

test('a clean handoff brief with manual review can start', () => {
  assert.deepEqual(gateCardState({ needsReview: false, reviewed: false }), {
    ready: true,
    status: '可以开工',
    pendingText: null,
  })
})

test('open disagreements keep the card pending until reviewed', () => {
  assert.equal(gateCardState({ needsReview: true, reviewed: false }).status, '有分歧')
  assert.equal(gateCardState({ needsReview: true, reviewed: false }).pendingText, '先确认这些分歧，再开工。')
  assert.equal(gateCardState({ needsReview: true, reviewed: true }).status, '可以开工')
})
