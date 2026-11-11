import assert from 'node:assert/strict'
import test from 'node:test'
import { independenceLabel, suggestFor } from './digest.js'

test('a solo room is signed off by the human, not labelled as degraded', () => {
  assert.equal(independenceLabel({ independence: 'solo' }), '单人 · 人签字')
})

test('the dispatch has no suggestion without rooms', () => {
  assert.equal(suggestFor('fix login', []), null)
})

test('a multi-seat room without a verifier says the human signs off', () => {
  assert.equal(independenceLabel({ independence: 'human' }), '人签字验收（无独立复核）')
})

test('the triad keeps the degraded label when both seats share one engine', () => {
  assert.equal(independenceLabel({ independence: 'none' }), '独立性降级')
  assert.equal(independenceLabel({ independence: 'vendor' }), '跨厂商复核')
})

test('dispatch routing scores room text before falling back to the active room', () => {
  const rooms = [
    { id: 'r1', name: '设置页保存', goal: '给设置页加保存', state: 'active', stages: [] },
    { id: 'r2', name: 'OAuth 登录', goal: '修登录回调', state: 'active', stages: [] },
    { id: 'r3', name: 'README', goal: '补文档', state: 'complete', stages: [] },
  ]
  assert.equal(suggestFor('设置页保存按钮修好', rooms).roomId, 'r1')
  assert.equal(suggestFor('登录回调地址错误', rooms).roomId, 'r2')
  assert.equal(suggestFor('完全无关的请求', rooms).roomId, 'r1')
})
