import assert from 'node:assert/strict'
import test from 'node:test'
import { latestReviewTimeout, reviewState } from './verifiers.js'

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

test('a review round keeps the verifiers it started with when a member is added', () => {
  const members = [
    { id: 'v1', role: 'verifier', roleKind: 'verifier' },
    { id: 'v2', role: 'verifier', roleKind: 'verifier' },
  ]
  const messages = [
    { kind: 'evidence', id: 'e1', seq: 1, meta: { stage: 0, kind: 'command', command: 'true', exit: 0 } },
    { kind: 'verdict', authorId: 'v1', seq: 2, meta: { stage: 0, pass: true, evidenceId: 'e1' } },
  ]
  const pinned = reviewState({
    room: { members, stages: [{ state: 'active', kind: 'deliverable', acceptance: 'true', reviewers: ['v1'] }] },
    messages,
    stageIndex: 0,
  })
  assert.equal(pinned.state, 'pass')
  assert.deepEqual(pinned.missing, [])
  const unpinned = reviewState({
    room: { members, stages: [{ state: 'active', kind: 'deliverable', acceptance: 'true' }] },
    messages,
    stageIndex: 0,
  })
  assert.equal(unpinned.state, 'pending')
  assert.deepEqual(unpinned.missing, ['v2'])
})
