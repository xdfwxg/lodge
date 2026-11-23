import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShadowAdvice, shadowAdviceFor, shadowAdviceForStage } from './advisor-advice.js'

const room = {
  messages: [
    { id: 'e1', kind: 'evidence', meta: { stage: 0, kind: 'manual' } },
  ],
  advisorShadow: {
    0: {
      evidenceId: 'e1',
      advice: [{ summary: '补一条回滚测试', reasons: ['缺少回滚测试'], risks: ['网络依赖'], missingEvidence: ['rollback.log'], score: 0.4 }],
      model: 'advisor-test',
    },
  },
}

test('shadow advice is read by evidence and keeps no score', () => {
  const advice = shadowAdviceFor(room, 'e1')
  assert.equal(advice.summary, '补一条回滚测试')
  assert.deepEqual(advice.reasons, ['缺少回滚测试'])
  assert.deepEqual(advice.missingEvidence, ['rollback.log'])
  assert.equal('score' in advice, false)
  assert.equal(shadowAdviceFor(room, 'e2'), null)
  assert.equal(shadowAdviceForStage(room, 0).summary, '补一条回滚测试')
  assert.equal(shadowAdviceForStage(room, 1), null)
})

test('the risk card renders summary, three row groups and the read-only tag', () => {
  const html = renderToStaticMarkup(h(ShadowAdvice, { room, stageIndex: 0 }))
  assert.match(html, /crew-shadow-card/)
  assert.match(html, /补一条回滚测试/)
  assert.match(html, /理由/)
  assert.match(html, /风险/)
  assert.match(html, /缺失结果/)
  assert.match(html, /仅供参考/)
})
