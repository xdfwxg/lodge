import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryFactsOf } from '../../acceptance.js'
import { proofFactsCheck } from './proof-facts.js'

const evidenceOf = proof => deliveryFactsOf({ evidence: { id: 'e1', meta: { proof, changedFiles: [] } } })
const pendingOf = (proof, extra = {}) => ({
  facts: evidenceOf(proof),
  requireProof: true,
  ...extra,
})
const call = pending => proofFactsCheck({
  pending,
  judgment: { decision: 'pass' },
  proofRejectionOf: () => '交付没有可重跑的证明',
})

test('a proof that never ran rewrites a PASS into the platform rejection', () => {
  const hit = call(pendingOf(null))
  assert.equal(hit.replace.decision, 'reject')
  assert.equal(hit.replace.platformRejected, 'proof')
  assert.equal(hit.replace.reason, '交付没有可重跑的证明')
})

test('a proof that ran red is a hard rejection too', () => {
  const hit = call(pendingOf({ status: 'failed', error: 'entry 退出 1' }))
  assert.equal(hit.replace.decision, 'reject')
})

test('a weak proof does not send the executor into an unfixable rework loop', () => {
  // 真房现场：第三步就是“交证明文件”，证明必然在改动前也绿；复核按退回处理，
  // 执行官只能把同一份证明再交一遍，连退三次。
  assert.equal(call(pendingOf({ status: 'verified', weak: true })), null)
})

test('a proof stage never counts as weak in the first place', () => {
  assert.equal(call(pendingOf({ status: 'verified', weak: true }, { proofIsDeliverable: true })), null)
})
