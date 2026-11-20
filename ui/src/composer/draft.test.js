import assert from 'node:assert/strict'
import test from 'node:test'
import { mentionAt } from './draft.js'

test('mention lookup only starts at a word boundary', () => {
  assert.deepEqual(mentionAt('请 @阿', 4), { start: 2, end: 4, query: '阿' })
  assert.deepEqual(mentionAt('请 @阿 看', 4), { start: 2, end: 4, query: '阿' })
  assert.equal(mentionAt('邮箱 a@b', 6), null)
  assert.equal(mentionAt('没有提到', 4), null)
})

test('mention lookup keeps the cursor as the end of the query', () => {
  assert.deepEqual(mentionAt('@阿青', 3), { start: 0, end: 3, query: '阿青' })
})
