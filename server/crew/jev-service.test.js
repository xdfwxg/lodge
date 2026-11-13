import assert from 'node:assert/strict'
import test from 'node:test'
import { createJevServer, evaluate, evaluateReviewRules } from '../jev-service.mjs'
import { createJevClient } from './jev.js'

test('rules evaluation scores gate and review without producing a verdict', () => {
  const gate = evaluateReviewRules({ evidence: { command: 'npm test', exit: 0, diff: 'D', files: ['a.js'] } })
  assert.equal(gate.score, 0.8)
  assert.equal(gate.pass, undefined)
  assert.equal(gate.model, 'lodge-jev-rules')

  const review = evaluateReviewRules({ evidence: { command: 'npm test', exit: 1 }, stage: { manual: true } })
  assert.equal(review.score, 0.2)
  assert.equal(review.pass, undefined)
  assert.ok(review.risks.some(text => text.includes('人工验收')))
})

test('model evaluation normalizes JSON advice and clamps the score', async () => {
  const result = await evaluate(
    { mode: 'gate', goal: '发布', verify: 'test', acceptance: 'npm test' },
    {
      mode: 'model',
      url: 'http://model.test/v1/chat/completions',
      model: 'jev-test',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"score":1.4,"summary":"结构完整","reasons":["目标清楚"],"risks":[],"missingEvidence":[]}\n```' } }],
        }),
      }),
    },
  )
  assert.equal(result.score, 1)
  assert.equal(result.summary, '结构完整')
  assert.equal(result.model, 'jev-test')
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
  assert.equal(result.model, 'lodge-jev-rules')
})

test('the reference service speaks the same contract as the Lodge client', async () => {
  const server = createJevServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const health = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json())
    assert.equal(health.ok, true)

    const client = createJevClient({ url: `http://127.0.0.1:${port}/evaluate`, timeoutMs: 2_000 })
    const result = await client.advice({
      mode: 'review',
      stage: { title: '实现', manual: false },
      evidence: { command: 'npm test', exit: 0, diff: 'D', files: ['a.js'] },
    })
    assert.equal(result.available, true)
    assert.equal(result.advice[0].score, 0.8)
    assert.match(result.advice[0].summary, /人工复核/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
