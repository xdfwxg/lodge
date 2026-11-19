import assert from 'node:assert/strict'
import test from 'node:test'
import { progressMarkdownOf, progressOf } from './progress.js'

const room = {
  goal: '把设置页做完',
  state: 'active',
  stages: [
    { title: '对齐', state: 'passed' },
    { title: '实现', state: 'active' },
    { title: '检查', state: 'pending' },
  ],
}

test('progress names what is done, what is left and who is next', () => {
  const progress = progressOf(room, [
    { kind: 'evidence', text: 'npm test 退出码 0', ts: 2 },
  ])
  assert.equal(progress.active.title, '实现')
  assert.equal(progress.next, '实现')
  assert.deepEqual(progress.done.map(stage => stage.title), ['对齐'])
  assert.deepEqual(progress.remaining.map(stage => stage.title), ['实现', '检查'])
  assert.match(progress.lastEvidence.text, /npm test/)
  const markdown = progressMarkdownOf(progress)
  assert.match(markdown, /已完成/)
  assert.match(markdown, /还剩/)
  assert.match(markdown, /下一步：实现/)
})

test('a finished room says it is done instead of leaving a next step blank', () => {
  const progress = progressOf({ goal: '完成', state: 'complete', stages: [{ title: '实现', state: 'passed' }] })
  assert.equal(progress.remaining.length, 0)
  assert.equal(progress.next, null)
  assert.match(progressMarkdownOf(progress), /全部完成/)
})
