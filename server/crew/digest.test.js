import assert from 'node:assert/strict'
import test from 'node:test'
import { independenceLabel, suggestFor } from './digest.js'

test('a solo room is signed off by the human, not labelled as degraded', () => {
  assert.equal(independenceLabel({ independence: 'solo' }), '单人 · 人签字')
})

test('the dispatch has no suggestion without rooms', () => {
  assert.equal(suggestFor('fix login', []), null)
})

test('a multi-seat room without a verifier says the human signs off', () => {
  assert.equal(independenceLabel({ independence: 'human' }), '人签字验收（无独立复核）')
})

test('the triad keeps the degraded label when both seats share one engine', () => {
  assert.equal(independenceLabel({ independence: 'none' }), '独立性降级')
  assert.equal(independenceLabel({ independence: 'vendor' }), '跨厂商复核')
})
