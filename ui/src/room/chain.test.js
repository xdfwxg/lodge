import assert from 'node:assert/strict'
import test from 'node:test'
import { isChainMessage } from './message-view.js'

test('only handoff-chain system messages reach the timeline', () => {
  // gate 现在只在人覆盖或自动交付时写入，是要让人知道的结果。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'gate' } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'gate', override: true } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'gate', auto: true } }), true)
  // 需要人处理的失败提示保留。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'notice', show: true }, text: '检查没通过 · 需要重做这一步' }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'handoff' } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'stage' } }), true)
  // 结果卡接手后，收尾回执不进时间线；显式隐藏的账本消息也不进。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'handoff', to: 'planner' }, text: '全部验收员通过；@规划师 收尾。' }), false)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'handoff', to: 'planner' }, text: '验收退回了第 1 步；@规划师 接手决定重做还是交给人。' }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'handoff', show: false } }), false)
  // 需要人处理的错误要看得见；自动重试的提示不占时间线。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'notice', show: true } }), true)
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'notice', show: false } }), false)
  // 技术性提醒放交付卡，不占时间线，避免让用户操心。
  assert.equal(isChainMessage({ kind: 'system', meta: { kind: 'visual' } }), false)
  assert.equal(isChainMessage({ kind: 'system' }), false)
  assert.equal(isChainMessage({ kind: 'chat', meta: { kind: 'handoff' } }), false)
})
