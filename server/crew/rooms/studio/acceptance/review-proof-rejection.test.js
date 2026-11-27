import assert from 'node:assert/strict'
import test from 'node:test'
import { proofRejectionOf } from './review.js'

test('the proof rejection names the review-copy failure and the support rule', () => {
  const text = proofRejectionOf({
    proofStatus: 'failed',
    proofFailure: 'Error: Cannot find module /tmp/lodge-proof-x/repo/.lodge/proof/c3.mjs',
  })
  assert.match(text, /复核副本里没有跑绿/)
  assert.match(text, /Cannot find module/)
  assert.match(text, /辅助文件必须随交付走/)
  assert.match(text, /\.lodge/)
})

test('an invalid proof carries the platform error instead of a generic hint', () => {
  const text = proofRejectionOf({
    proofStatus: 'invalid',
    proofError: '证明引用了成员私有目录（.lodge/）；辅助文件要随交付走（例如 tools/）',
  })
  assert.match(text, /成员私有目录/)
  assert.match(text, /tools\//)
})
