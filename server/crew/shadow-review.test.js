import assert from 'node:assert/strict'
import test from 'node:test'
import { buildShadowComparison } from './shadow-review.js'

const evidence = (id, over = {}) => ({
  id,
  digest: `digest-${id}`,
  at: 1,
  meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0, ...over },
})

const verdict = (evidenceId, pass, over = {}) => ({
  kind: 'verdict',
  authorId: 'verifier',
  meta: { evidenceId, pass, stage: 1, mode: 'bot', ...over },
})

const advice = (evidenceId, score, over = {}) => ({
  kind: 'advisor_advice',
  meta: { evidenceId, stage: 1, shadow: true, model: 'test', advice: [{ score, summary: 's', ...over }] },
})

test('shadow comparison marks agree, disagree, neutral and missing advice', () => {
  const result = buildShadowComparison({
    evidence: [evidence('e1'), evidence('e2'), evidence('e3'), evidence('e4')],
    messages: [
      verdict('e1', true),
      advice('e1', 0.8),
      verdict('e2', false),
      advice('e2', 0.9),
      verdict('e3', true),
      advice('e3', 0.5),
      verdict('e4', true),
    ],
  })
  assert.equal(result.summary.total, 4)
  assert.equal(result.summary.agree, 1)
  assert.equal(result.summary.disagree, 1)
  assert.equal(result.summary.neutral, 1)
  assert.equal(result.summary.missing, 1)
  assert.equal(result.rows.find(row => row.evidenceId === 'e2').status, 'disagree')
  assert.equal(result.rows.find(row => row.evidenceId === 'e4').advice, null)
})

test('multiple verifier verdicts are marked mixed rather than forced to one side', () => {
  const result = buildShadowComparison({
    evidence: [evidence('e1')],
    messages: [verdict('e1', true), verdict('e1', false), advice('e1', 0.8)],
  })
  assert.equal(result.rows[0].verdictState, 'mixed')
  assert.equal(result.rows[0].status, 'mixed')
  assert.equal(result.summary.mixed, 1)
})

test('the comparison is read-only and does not invent advice when none was recorded', () => {
  const result = buildShadowComparison({ evidence: [evidence('e1')], messages: [verdict('e1', true)] })
  assert.equal(result.rows[0].status, 'missing')
  assert.equal(result.rows[0].advice, null)
})
