import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateProposal, promptFormatOf } from './planning-eval.js'

const result = proposal => ({ ok: true, body: { proposal } })
const good = {
  done: ['`node --test` 通过', '`--verbose` 输出每步耗时'],
  questions: [{ text: '耗时写到 stderr 还是 stdout？', recommendation: 'stderr' }],
  members: [
    { role: 'lead', name: '规划师', reason: '对齐目标' },
    { role: 'worker', name: '执行者', reason: '实现与跑测试' },
    { role: 'verifier', name: '验收员', reason: '独立复核' },
  ],
  verify: 'test',
  acceptance: 'node --test',
  why: '固定三人小队分工',
}

test('a concrete three-member opening card passes the rubric', () => {
  const report = evaluateProposal(result(good), {
    minMembers: 3,
    maxMembers: 3,
    maxVerifiers: 1,
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
    questions: [{ text: '要不要加一个验收成员？', recommendation: '要' }],
    verify: 'manual',
    acceptance: '',
  }), { requireTest: true })
  assert.equal(report.pass, false)
  assert.equal(report.failures.some(item => item.id === 'case-require-test'), true)
  assert.equal(report.failures.some(item => item.id === 'question-no-mechanism'), true)
})

test('a fixed-team why does not claim a missing verifier', () => {
  const report = evaluateProposal(result({
    ...good,
    why: '固定三人分工，验收成员独立复核',
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

test('a question about a fact already in the workspace fails the rubric', () => {
  const report = evaluateProposal(result({
    ...good,
    questions: [{ text: '用哪个文件保存配置？', recommendation: 'config.json' }],
  }), {})
  assert.equal(report.failures.some(item => item.id === 'question-no-known-fact'), true)
})

test('a worker named 验收 and a why claiming a verifier fail', () => {
  const report = evaluateProposal(result({
    ...good,
    members: [{ role: 'worker', name: '验收' }],
    why: '两个执行成员加一个独立验收正好',
  }), {})
  assert.equal(report.failures.some(item => item.id === 'member-role-name'), true)
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
    members: [{ role: 'lead', name: '队长' }],
  }), {})
  assert.equal(report.pass, false)
  assert.equal(report.failures.some(item => item.id === 'workers'), true)
})

test('prompt format reports a one-line why without judging the plan', () => {
  assert.deepEqual(promptFormatOf({ why: '本任务由 3 人协作完成：规划师定顺序，执行官落文件，验收员复核。' }), {
    whyOneLine: true,
    whyPrefix: true,
    whyLength: 33,
  })
  assert.equal(promptFormatOf({ why: '第一行\n第二行' }).whyOneLine, false)
  assert.equal(promptFormatOf({ why: '很'.repeat(80) }).whyOneLine, false)
  assert.equal(promptFormatOf({}).whyPrefix, false)
})
