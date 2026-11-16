import assert from 'node:assert/strict'
import test from 'node:test'
import { independenceLabel } from './digest.js'

test('a multi-seat room without a verifier says the human signs off', () => {
  assert.equal(independenceLabel({ independence: 'human' }), '你签字验收')
})

test('the triad keeps the degraded label when both seats share one engine', () => {
  assert.equal(independenceLabel({ independence: 'none' }), '这次复核不够独立')
  assert.equal(independenceLabel({ independence: 'vendor' }), '独立复核')
})
