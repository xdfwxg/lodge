import assert from 'node:assert/strict'
import test from 'node:test'
import { prDraftOf } from './pr-draft.js'

const room = {
  name: '导出按钮',
  goal: '加一个导出 CSV 的按钮',
  workspace: { provider: 'git' },
}

const delivery = {
  commands: [{ command: 'npm test', exit: 0 }],
  changedFiles: ['src/export.js', 'src/export.test.js'],
  stages: [{ verdicts: [{ pass: true, text: '导出结果正确' }] }],
}

test('a PR draft carries summary, before/after evidence, and merge danger', () => {
  const draft = prDraftOf(room, [{ kind: 'rework', text: '导出列数不对' }], delivery)
  assert.match(draft.body, /## Summary/)
  assert.match(draft.body, /加一个导出 CSV 的按钮/)
  assert.match(draft.body, /Before:\*\* 导出列数不对/)
  assert.match(draft.body, /npm test/)
  assert.match(draft.body, /Door:\*\* two-way/)
  assert.match(draft.body, /Blast Radius:\*\* 2 个文件/)
})

test('a direct workspace is a one-way door', () => {
  const draft = prDraftOf({ ...room, workspace: { provider: 'direct' } }, [], delivery)
  assert.equal(draft.door, 'one-way')
})

test('no delivery means no PR draft', () => {
  assert.equal(prDraftOf(room, [], null), null)
})
