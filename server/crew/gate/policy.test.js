import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewRoomGate } from './policy.js'

const brief = overrides => ({
  topic: '发布前检查',
  consensus: ['先做最小版本'],
  disagreements: [],
  constraints: [],
  todos: [],
  ...overrides,
})

test('a room without a handoff brief can start', () => {
  assert.equal(reviewRoomGate().decision, 'allow')
})

test('a clean handoff brief can start', () => {
  const review = reviewRoomGate({ handoffBrief: brief() })
  assert.equal(review.decision, 'allow')
  assert.deepEqual(review.issues, [])
  assert.equal(review.needsHumanReview, false)
})

test('unreviewed disagreements keep the room from starting', () => {
  const review = reviewRoomGate({ handoffBrief: brief({ disagreements: ['是否自动回滚'] }) })
  assert.equal(review.decision, 'reject')
  assert.equal(review.needsHumanReview, true)
  assert.deepEqual(review.issues, [{
    code: 'handoff-brief-disagreements-unreviewed',
    text: '交接简报还有未解决的分歧，待确认后再开工',
  }])
  assert.equal(reviewRoomGate({
    handoffBrief: brief({ disagreements: ['是否自动回滚'] }),
    humanReviewed: true,
  }).decision, 'allow')
})

test('a handoff brief without a topic keeps the room from starting', () => {
  const review = reviewRoomGate({ handoffBrief: brief({ topic: '  ' }) })
  assert.equal(review.decision, 'reject')
  assert.deepEqual(review.issues.map(issue => issue.code), ['handoff-brief-topic-missing'])
})

