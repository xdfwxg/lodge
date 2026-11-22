import assert from 'node:assert/strict'
import test from 'node:test'
import { homeRelative } from './home-path.js'

test('a home directory shows as ~ and keeps the rest of the path', () => {
  assert.equal(homeRelative('/Users/千寻/work/app'), '~/work/app')
  assert.equal(homeRelative('工作文件夹：/Users/千寻/work/app，先看这里'), '工作文件夹：~/work/app，先看这里')
  assert.equal(homeRelative('(/home/alice/repo)'), '(~/repo)')
})

test('other paths and non-text values stay as they are', () => {
  assert.equal(homeRelative('/tmp/crew/work'), '/tmp/crew/work')
  assert.equal(homeRelative('https://example.com/Users/bob/profile'), 'https://example.com/Users/bob/profile')
  assert.equal(homeRelative(undefined), undefined)
})
