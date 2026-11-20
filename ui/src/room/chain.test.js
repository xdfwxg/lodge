import assert from 'node:assert/strict'
import test from 'node:test'
import { isChainMessage } from './message-view.js'

test('only handoff-chain system messages reach the timeline', () => {
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'gate' } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'handoff' } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'stage' } }), true)
  // 需要人处理的错误要看得见；自动重试的提示不占时间线。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'notice', show: true } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'notice', show: false } }), false)
  // 技术性提醒放交付卡，不占时间线，避免让用户操心。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'visual' } }), false)
  assert.equal(isChainMessage({ kind: 'system' }), false)
  assert.equal(isChainMessage({ kind: 'chat', meta: { kind: 'handoff' } }), false)
})
