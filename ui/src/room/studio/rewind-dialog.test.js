import assert from 'node:assert/strict'
import test from 'node:test'
import { adjustableStagesOf, rewindActionLabel, workStagesOf } from './rewind-dialog.js'

test('only work stages can be rewound', () => {
  const room = {
    stages: [
      { title: '目标对齐', kind: 'decision', state: 'passed' },
      { title: '实现', kind: 'deliverable', state: 'passed' },
      { title: '人工确认', kind: 'decision', manual: true, state: 'active' },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }
  assert.deepEqual(workStagesOf(room).map(stage => [stage.index, stage.title]), [
    [1, '实现'],
    [2, '人工确认'],
  ])
  assert.deepEqual(workStagesOf({}), [])
})

test('the human can reopen any non-pending node', () => {
  const room = {
    stages: [
      { title: '目标对齐', kind: 'decision', state: 'passed' },
      { title: '实现', kind: 'deliverable', state: 'active' },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }
  assert.deepEqual(adjustableStagesOf(room).map(stage => stage.title), ['目标对齐', '实现'])
  assert.deepEqual(adjustableStagesOf({}), [])
})

test('an active step adds context, a passed step rewinds', () => {
  assert.equal(rewindActionLabel('active'), '补一句再跑')
  assert.equal(rewindActionLabel('passed'), '退回并重跑')
  assert.equal(rewindActionLabel(undefined), '退回并重跑')
})
