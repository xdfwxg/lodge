import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewRoomGate } from './policy.js'
import { gateRecordOf } from './record.js'

const handoff = overrides => ({
  topic: '发布前检查',
  consensus: ['先做最小版本'],
  disagreements: [],
  constraints: [],
  todos: [],
  ...overrides,
})

test('the record keeps the decision, reasons and advisor metadata', () => {
  const review = reviewRoomGate({ handoff: handoff({ disagreements: ['是否自动回滚'] }) })
  const record = gateRecordOf({
    review,
    advisor: { available: true, model: 'advisor-test', version: 'v1' },
    check: { mode: 'test', acceptance: 'npm test' },
  })
  assert.equal(record.decision, 'reject')
  assert.equal(record.issues[0].code, 'handoff-disagreements-unreviewed')
  assert.deepEqual(record.advisor, { available: true, model: 'advisor-test', version: 'v1' })
  assert.deepEqual(record.verification, { mode: 'test', command: 'npm test' })
  assert.ok(record.at > 0)
  assert.equal(record.humanReviewed, false)
  assert.equal(record.reviewedAt, null)
})

test('a human signoff is recorded only where disagreements needed one', () => {
  const reviewed = gateRecordOf({
    review: reviewRoomGate({ handoff: handoff({ disagreements: ['是否自动回滚'] }), humanReviewed: true }),
    humanReviewed: true,
  })
  assert.equal(reviewed.humanReviewed, true)
  assert.ok(reviewed.reviewedAt > 0)

  const clean = gateRecordOf({ review: reviewRoomGate({ handoff: handoff() }), check: { mode: 'manual', acceptance: '' } })
  assert.equal('humanReviewed' in clean, false)
  assert.deepEqual(clean.advisor, { available: false })
  assert.deepEqual(clean.verification, { mode: 'manual' })
})
