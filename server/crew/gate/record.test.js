import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewRoomGate } from './policy.js'
import { gateRecordOf } from './record.js'

const brief = overrides => ({
  topic: '发布前检查',
  consensus: ['先做最小版本'],
  disagreements: [],
  constraints: [],
  todos: [],
  ...overrides,
})

test('the record keeps the decision and reasons', () => {
  const review = reviewRoomGate({ handoffBrief: brief({ disagreements: ['是否自动回滚'] }) })
  const record = gateRecordOf({ review })
  assert.equal(record.decision, 'reject')
  assert.equal(record.issues[0].code, 'handoff-brief-disagreements-unreviewed')
  assert.ok(record.at > 0)
  assert.equal(record.humanReviewed, false)
  assert.equal(record.reviewedAt, null)
})

test('a human signoff is recorded only where disagreements needed one', () => {
  const reviewed = gateRecordOf({
    review: reviewRoomGate({ handoffBrief: brief({ disagreements: ['是否自动回滚'] }), humanReviewed: true }),
    humanReviewed: true,
  })
  assert.equal(reviewed.humanReviewed, true)
  assert.ok(reviewed.reviewedAt > 0)

  const clean = gateRecordOf({ review: reviewRoomGate({ handoffBrief: brief() }) })
  assert.equal('humanReviewed' in clean, false)
})
