import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateProposal } from './planning-eval.js'

const result = proposal => ({ ok: true, body: { proposal } })
const good = {
  done: ['`node --test` 通过', '`--verbose` 输出每步耗时'],
  questions: [{ text: '耗时写到 stderr 还是 stdout？', recommendation: 'stderr' }],
  seats: [{ role: 'worker', name: '执行', reason: '小改动' }],
  verify: 'test',
  acceptance: 'node --test',
  why: '单人足够',
}

test('a concrete solo opening card passes the rubric', () => {
  const report = evaluateProposal(result(good), {
    minSeats: 1,
    maxSeats: 2,
    maxVerifiers: 0,
    maxQuestions: 2,
    requireTest: true,
    doneKeywords: ['测试', '耗时'],
    acceptancePattern: 'node --test|npm test',
  })
  assert.equal(report.pass, true)
  assert.equal(report.score, 100)
})

test('a mechanism question and missing acceptance fail the rubric', () => {
  const report = evaluateProposal(result({
    ...good,
    questions: [{ text: '要不要加一个验收席位？', recommendation: '要' }],
    verify: 'manual',
    acceptance: '',
  }), { requireTest: true })
  assert.equal(report.pass, false)
  assert.equal(report.failures.some(item => item.id === 'case-require-test'), true)
  assert.equal(report.failures.some(item => item.id === 'question-no-mechanism'), true)
})

test('a negative why does not claim a missing verifier', () => {
  const report = evaluateProposal(result({
    ...good,
    why: '单人足够，无需加一个独立验收',
  }), {})
  assert.equal(report.failures.some(item => item.id === 'why-verifier'), false)
})

test('a product question about page count is not a mechanism question', () => {
  const report = evaluateProposal(result({
    ...good,
    questions: [{ text: '这个功能需要几个页面？', recommendation: '一个页面' }],
  }), {})
  assert.equal(report.failures.some(item => item.id === 'question-no-mechanism'), false)
})

test('a worker named 验收 and a why claiming a verifier fail', () => {
  const report = evaluateProposal(result({
    ...good,
    seats: [{ role: 'worker', name: '验收' }],
    why: '两个执行席位加一个独立验收正好',
  }), {})
  assert.equal(report.failures.some(item => item.id === 'seat-role-name'), true)
  assert.equal(report.failures.some(item => item.id === 'why-verifier'), true)
})

test('parser trimming is visible to the rubric', () => {
  const report = evaluateProposal(result({
    ...good,
    note: '队长给了超过 3 个问题，只保留前 3 个',
  }), {})
  assert.equal(report.failures.some(item => item.id === 'parser-trim'), true)
})

test('a proposal without a worker fails closed', () => {
  const report = evaluateProposal(result({
    ...good,
    seats: [{ role: 'lead', name: '队长' }],
  }), {})
  assert.equal(report.pass, false)
  assert.equal(report.failures.some(item => item.id === 'workers'), true)
})
