import assert from 'node:assert/strict'
import test from 'node:test'
import { clipText, searchTerms } from './message-search.js'

test('a Chinese question becomes three-character windows', () => {
  const terms = searchTerms('上次为什么选方案')
  assert.equal(terms.includes('为什么'), true)
  assert.equal(terms.includes('选方案'), true)
})

test('a short term stays whole for the fallback search', () => {
  assert.deepEqual(searchTerms('拼音'), ['拼音'])
  assert.deepEqual(searchTerms('npm test'), ['npm', 'tes', 'est'])
})

test('punctuation and repeated windows are dropped', () => {
  assert.deepEqual(searchTerms('为什么？为什么！'), ['为什么'])
  assert.deepEqual(searchTerms(''), [])
})

test('indexed text is capped', () => {
  assert.equal(clipText('x'.repeat(5000), 10).length, 10)
})
