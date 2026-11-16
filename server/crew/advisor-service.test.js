import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdvisorServer, evaluate, evaluateReviewRules } from '../advisor-service.mjs'
import { createAdvisorClient } from './advisor.js'

test('rules evaluation gives advice without a score or verdict', () => {
  const gate = evaluateReviewRules({ evidence: { command: 'npm test', exit: 0, diff: 'D', files: ['a.js'] } })
  assert.equal('score' in gate, false)
  assert.equal(gate.pass, undefined)
  assert.equal(gate.model, 'lodge-advisor-rules')

  const review = evaluateReviewRules({ evidence: { command: 'npm test', exit: 1 }, stage: { manual: true } })
  assert.equal('score' in review, false)
  assert.equal(review.pass, undefined)
  assert.ok(review.risks.some(text => text.includes('人工验收')))
})

test('model evaluation normalizes JSON advice without a score', async () => {
  const result = await evaluate(
    { mode: 'gate', goal: '发布', verify: 'test', acceptance: 'npm test' },
    {
      mode: 'model',
      url: 'http://model.test/v1/chat/completions',
      model: 'advisor-test',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"summary":"结构完整","reasons":["目标清楚"],"risks":[],"missingEvidence":[]}\n```' } }],
        }),
      }),
    },
  )
  assert.equal('score' in result, false)
  assert.equal(result.summary, '结构完整')
  assert.equal(result.model, 'advisor-test')
  assert.equal(result.pass, undefined)
})

test('a broken model falls back to rules instead of blocking the room', async () => {
  const result = await evaluate(
    { mode: 'gate', goal: '发布' },
    {
      mode: 'model',
      url: 'http://model.test/v1/chat/completions',
      fetchImpl: async () => ({ ok: false, status: 503 }),
    },
  )
  assert.equal(result.pass, undefined)
  assert.match(result.warning, /回退规则/)
  assert.equal(result.model, 'lodge-advisor-rules')
})

test('the reference service speaks the same contract as the Lodge client', async () => {
  const server = createAdvisorServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const health = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json())
    assert.equal(health.ok, true)

    const client = createAdvisorClient({ url: `http://127.0.0.1:${port}/evaluate`, timeoutMs: 2_000 })
    const result = await client.advice({
      mode: 'review',
      stage: { title: '实现', manual: false },
      evidence: { command: 'npm test', exit: 0, diff: 'D', files: ['a.js'] },
    })
    assert.equal(result.available, true)
    assert.equal('score' in result.advice[0], false)
    assert.match(result.advice[0].summary, /人工复核/)
    assert.equal(result.advice[0].source, 'advisor')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
