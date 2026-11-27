import assert from 'node:assert/strict'
import test from 'node:test'
import { visualMatchesAudit } from './review.js'

const audit = { colors: 120, contrast: 5, blank: false }

test('a visual claim must match the platform audit', () => {
  assert.equal(visualMatchesAudit(audit, { seen: true, colors: 120, contrast: 5 }), true)
  assert.equal(visualMatchesAudit(audit, { seen: true, colors: 121, contrast: 5 }), true)
  assert.equal(visualMatchesAudit(audit, { seen: true, colors: 3, contrast: 9 }), false)
  assert.equal(visualMatchesAudit(audit, { seen: true }), false)
})

test('a blank render cannot be claimed as seen, and unseen carries no numbers', () => {
  assert.equal(visualMatchesAudit({ ...audit, blank: true }, { seen: true, colors: 120, contrast: 5 }), false)
  assert.equal(visualMatchesAudit(audit, { seen: false }), true)
  assert.equal(visualMatchesAudit(audit, { seen: false, colors: 120 }), false)
})

test('no platform audit means there is nothing to contradict', () => {
  assert.equal(visualMatchesAudit(null, null), true)
})
