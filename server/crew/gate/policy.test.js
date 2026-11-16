import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewRoomGate } from './policy.js'

const handoff = overrides => ({
  topic: '发布前检查',
  consensus: ['先做最小版本'],
  disagreements: [],
  constraints: [],
  todos: [],
  ...overrides,
})

test('a room without a handoff can start', () => {
  assert.equal(reviewRoomGate().decision, 'allow')
})

test('a clean handoff can start', () => {
  const review = reviewRoomGate({ handoff: handoff() })
  assert.equal(review.decision, 'allow')
  assert.deepEqual(review.issues, [])
  assert.equal(review.needsHumanReview, false)
})

test('unreviewed disagreements keep the room from starting', () => {
  const review = reviewRoomGate({ handoff: handoff({ disagreements: ['是否自动回滚'] }) })
  assert.equal(review.decision, 'reject')
  assert.equal(review.needsHumanReview, true)
  assert.deepEqual(review.issues, [{
    code: 'handoff-disagreements-unreviewed',
    text: '交接单还有未解决的分歧，需要你确认后再开工',
  }])
  assert.equal(reviewRoomGate({
    handoff: handoff({ disagreements: ['是否自动回滚'] }),
    humanReviewed: true,
  }).decision, 'allow')
})

test('a handoff without a topic keeps the room from starting', () => {
  const review = reviewRoomGate({ handoff: handoff({ topic: '  ' }) })
  assert.equal(review.decision, 'reject')
  assert.deepEqual(review.issues.map(issue => issue.code), ['handoff-topic-missing'])
})

