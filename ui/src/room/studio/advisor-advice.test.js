import assert from 'node:assert/strict'
import test from 'node:test'
import { shadowAdviceFor, shadowAdviceForStage } from './advisor-advice.js'

const room = {
  messages: [
    {
      id: 'a1',
      kind: 'advisor_advice',
      meta: {
        evidenceId: 'e1',
        stage: 0,
        advice: [{ summary: '补一条回滚测试', reasons: ['缺少回滚测试'], risks: ['网络依赖'], missingEvidence: ['rollback.log'], score: 0.4 }],
        model: 'advisor-test',
      },
    },
  ],
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
