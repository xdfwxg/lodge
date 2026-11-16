import assert from 'node:assert/strict'
import test from 'node:test'
import { independenceLabel } from './digest.js'

test('a multi-member room without a verifier says the human signs off', () => {
  assert.equal(independenceLabel({ independence: 'human' }), '你签字验收')
})

test('the triad calls same-engine review a self check', () => {
  assert.equal(independenceLabel({ independence: 'none' }), '同家模型自查')
  assert.equal(independenceLabel({ independence: 'model' }), '同家模型自查')
  assert.equal(independenceLabel({ independence: 'vendor' }), '独立复核')
})
