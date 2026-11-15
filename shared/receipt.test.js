import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeReceipt, receiptText } from './receipt.js'

test('a receipt keeps result, completeness, checks and open questions', () => {
  const receipt = normalizeReceipt({
    result: '发布前检查清单',
    completeness: '3/3 阶段完成',
    checks: ['npm test 通过'],
    openQuestions: ['是否需要自动回滚？'],
  })
  assert.deepEqual(receipt, {
    result: '发布前检查清单',
    completeness: '3/3 阶段完成',
    checks: ['npm test 通过'],
    openQuestions: ['是否需要自动回滚？'],
  })
  assert.match(receiptText(receipt), /完成度：3\/3 阶段完成/)
  assert.match(receiptText(receipt), /待确认：是否需要自动回滚？/)
})

test('an empty receipt is not a receipt', () => {
  assert.equal(normalizeReceipt(null), null)
  assert.equal(normalizeReceipt({}), null)
  assert.equal(receiptText(null), '')
})

test('receipt values are bounded', () => {
  const receipt = normalizeReceipt({
    result: 'x'.repeat(400),
    completeness: 'y'.repeat(200),
    checks: Array.from({ length: 10 }, (_, index) => `检查${index}`),
  })
  assert.equal(receipt.result.length, 300)
  assert.equal(receipt.completeness.length, 120)
  assert.equal(receipt.checks.length, 6)
})
