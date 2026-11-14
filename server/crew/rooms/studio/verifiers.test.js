import assert from 'node:assert/strict'
import test from 'node:test'
import { latestReviewTimeout } from './verifiers.js'

const timeout = (ts, stage = 0) => ({
  kind: 'system',
  ts,
  seq: 1,
  meta: { kind: 'review_timeout', stage, verifiers: ['v1'] },
})

test('the latest review timeout is found per stage', () => {
  const messages = [timeout(10), timeout(20), timeout(30, 1)]
  assert.equal(latestReviewTimeout(messages, 0).ts, 20)
  assert.equal(latestReviewTimeout(messages, 1).ts, 30)
  assert.equal(latestReviewTimeout(messages, 2), undefined)
  assert.equal(latestReviewTimeout([], 0), undefined)
})
