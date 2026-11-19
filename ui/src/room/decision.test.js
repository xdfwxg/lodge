import assert from 'node:assert/strict'
import test from 'node:test'
import { pausedMemberFixOf } from './decision.js'

const paused = (kind, memberId = 'worker') => ({
  state: 'paused',
  pauseReason: 'member_error',
  memberError: { memberId, kind },
})

test('a stopped member points at the fix, not only at resume', () => {
  assert.deepEqual(pausedMemberFixOf(paused('auth')), { memberId: 'worker', label: '重新登录' })
  assert.deepEqual(pausedMemberFixOf(paused('quota')), { memberId: 'worker', label: '换个模型' })
  assert.deepEqual(pausedMemberFixOf(paused('rate_limit')), { memberId: 'worker', label: '换个模型' })
  assert.deepEqual(pausedMemberFixOf(paused('engine')), { memberId: 'worker', label: '检查模型服务' })
})

test('a room that is not stopped on a member has no member fix', () => {
  assert.equal(pausedMemberFixOf({ state: 'active' }), null)
  assert.equal(pausedMemberFixOf({ state: 'paused', pauseReason: 'mcp' }), null)
  assert.equal(pausedMemberFixOf(paused('auth', '')), null)
})
