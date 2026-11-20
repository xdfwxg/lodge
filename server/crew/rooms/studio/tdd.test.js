import assert from 'node:assert/strict'
import test from 'node:test'
import { tddIssueOf } from './tdd.js'

const stage = { kind: 'deliverable', acceptance: 'npm test' }
const evidence = changedFiles => ({ meta: { changedFiles } })

test('code without a test change is refused', () => {
  assert.match(tddIssueOf(stage, evidence(['src/a.js'])), /没有测试改动/)
  assert.match(tddIssueOf(stage, evidence(['src/a.ts', 'src/b.ts'])), /2 个代码文件/)
})

test('a test change next to the code is enough', () => {
  assert.equal(tddIssueOf(stage, evidence(['src/a.js', 'src/a.test.js'])), '')
  assert.equal(tddIssueOf(stage, evidence(['app/a.ts', 'app/__tests__/a.ts'])), '')
  assert.equal(tddIssueOf(stage, evidence(['pkg/a.go', 'pkg/a_test.go'])), '')
})

test('docs, config and data changes do not demand a test', () => {
  assert.equal(tddIssueOf(stage, evidence(['README.md'])), '')
  assert.equal(tddIssueOf(stage, evidence(['docs/guide.md', 'package.json'])), '')
  assert.equal(tddIssueOf(stage, evidence(['data/seed.json'])), '')
})

test('non test-runner checks are left alone', () => {
  assert.equal(tddIssueOf({ acceptance: 'node scripts/check.mjs' }, evidence(['src/a.js'])), '')
  assert.equal(tddIssueOf({ acceptance: 'test -f out.png' }, evidence(['src/a.js'])), '')
  assert.equal(tddIssueOf({ acceptance: 'manual' }, evidence(['src/a.js'])), '')
})

test('weak or simulated evidence never blocks', () => {
  assert.equal(tddIssueOf(stage, { meta: {} }), '')
  assert.equal(tddIssueOf(stage, { meta: { changedFiles: [], simulated: true } }), '')
  assert.equal(tddIssueOf(stage, { meta: { changedFiles: ['src/a.js'], simulated: true } }), '')
})
