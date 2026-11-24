import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTEXT_BUDGET, evidenceDigest, recentAndOlder, stageDigest } from './prompt-context.js'

const message = (index, text, authorId = 'worker') => ({ id: `m${index}`, kind: 'chat', authorId, text })
const nameOf = item => (item.authorId === 'you' ? '你' : item.authorId)

test('recent turns stay verbatim and older ones collapse to one line', () => {
  const messages = [
    ...Array.from({ length: 8 }, (_, index) => message(index, `旧发言 ${index} ${'x'.repeat(200)}`)),
    message(8, '最近的甲'),
    message(9, '最近的乙'),
  ]
  const lines = recentAndOlder(messages, { nameOf, recent: 2 })
  assert.equal(lines.at(-1), 'worker：最近的乙')
  assert.match(lines.at(-2), /^worker：最近的甲/)
  assert.equal(lines.length, 10)
  for (const line of lines.slice(0, -2)) assert.ok(line.length <= 90, 'older lines are clipped')
})

test('the context budget is a hard ceiling', () => {
  const messages = Array.from({ length: 40 }, (_, index) => message(index, 'y'.repeat(280)))
  const lines = recentAndOlder(messages, { nameOf })
  const total = lines.reduce((sum, line) => sum + line.length, 0)
  assert.ok(total <= CONTEXT_BUDGET.recent + CONTEXT_BUDGET.older)
  assert.ok(lines.length > 0)
})

test('the evidence digest keeps result facts inside its budget', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `e${index}`,
    kind: 'evidence',
    meta: { stage: 1, kind: 'result', changedFiles: ['src/a.js'] },
  }))
  const lines = evidenceDigest(messages)
  assert.ok(lines.length > 0)
  assert.match(lines.at(-1), /阶段 2 · 结果 · src\/a\.js/)
  assert.ok(lines.reduce((sum, line) => sum + line.length, 0) <= CONTEXT_BUDGET.evidence)
})

test('historical stages keep only state and the latest verdict', () => {
  const room = {
    stages: [
      { title: '对齐', state: 'passed' },
      { title: '实现', state: 'active' },
    ],
  }
  const messages = [
    { kind: 'verdict', meta: { stage: 0, pass: false } },
    { kind: 'verdict', meta: { stage: 0, pass: true } },
  ]
  assert.deepEqual(stageDigest(room, messages), ['1. 对齐 · passed · 通过', '2. 实现 · active'])
})
