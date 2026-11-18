import assert from 'node:assert/strict'
import test from 'node:test'
import { fenceUntrusted, sanitizeUntrusted } from './untrusted-text.js'

test('invisible and control characters are removed before the budget', () => {
  const text = `看​这‮里\u0000的﻿内容`
  assert.equal(sanitizeUntrusted(text), '看这里的内容')
})

test('a long tool result is clipped with an explicit ellipsis', () => {
  const text = 'a'.repeat(100)
  const out = sanitizeUntrusted(text, 10)
  assert.equal(out, `${'a'.repeat(10)}…`)
})

test('the fence outruns any backtick run in the content', () => {
  const fenced = fenceUntrusted('```\ncode\n```', { lang: 'diff', max: 100 })
  assert.match(fenced, /^````diff\n/)
  assert.match(fenced, /\n````$/)
  assert.doesNotMatch(fenced, /````\s*````/)
})

test('normal text passes through untouched', () => {
  assert.equal(sanitizeUntrusted('普通的中文和 code'), '普通的中文和 code')
})
