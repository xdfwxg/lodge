import assert from 'node:assert/strict'
import test from 'node:test'
import { bodyIssueOf, bodyIssueText } from './body-check.js'

test('a represented body is ready unless it is missing, unavailable or logged out', () => {
  assert.equal(bodyIssueOf(undefined), '')
  assert.equal(bodyIssueOf({ available: true }), '')
  assert.equal(bodyIssueOf({ available: true, authenticated: false }), '登录失效')
  assert.equal(bodyIssueOf({ available: false, reason: 'CLI not found' }), 'CLI not found')
  assert.equal(bodyIssueOf({ available: false, reason: '' }), '模型服务不可用')
  assert.equal(bodyIssueOf({ available: true, models: { default: '', options: [] } }), '没有配置模型')
})

test('body issues name the member they belong to', () => {
  const text = bodyIssueText([
    { member: { name: '执行官' }, issue: '登录失效' },
    { member: { name: '验收员' }, issue: '' },
    { member: { name: '规划师' }, issue: '模型服务不可用' },
  ])
  assert.equal(text, '执行官登录失效；规划师模型服务不可用')
})
