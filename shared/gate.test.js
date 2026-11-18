import test from 'node:test'
import assert from 'node:assert/strict'
import { gateSubmissionOf } from './gate.js'
import { judgmentFromGate } from './judgment.js'

const verdict = overrides => ({
  name: 'mcp__lodge_gate__submit_verdict',
  input: JSON.stringify({
    decision: 'PASS',
    reason: '文件内容和检查都对',
    ...overrides,
  }),
})

test('a gate verdict arrives without parsing the reply text', () => {
  const judgment = gateSubmissionOf([verdict()], {
    stage: 1,
    evidenceId: 'ev-1',
    actorId: 'verifier',
    at: 12,
  })
  assert.equal(judgment.type, 'verdict')
  assert.equal(judgment.decision, 'pass')
  assert.equal(judgment.reason, '文件内容和检查都对')
  assert.equal(judgment.source, 'gate')
  assert.equal(judgment.stage, 1)
  assert.equal(judgment.evidenceId, 'ev-1')
  assert.equal(judgment.actorId, 'verifier')
  assert.equal(judgment.at, 12)
})

test('findings and object inputs keep the same contract', () => {
  const judgment = gateSubmissionOf([{
    name: 'submit_verdict',
    input: {
      decision: 'REJECT',
      reason: '缺少日志',
      findings: [{ title: '没有运行记录', severity: 'major', evidence: 'log.txt 不存在' }],
    },
  }], { type: 'verdict' })
  assert.equal(judgment.decision, 'reject')
  assert.deepEqual(judgment.findings, [{
    title: '没有运行记录',
    severity: 'major',
    evidence: 'log.txt 不存在',
  }])
})

test('the last valid submission wins and malformed calls are skipped', () => {
  const judgment = gateSubmissionOf([
    verdict({ decision: 'REJECT', reason: '旧结论' }),
    { name: 'mcp__lodge_gate__submit_verdict', input: '{not json' },
    verdict({ decision: 'PASS', reason: '新结论' }),
  ], { type: 'verdict' })
  assert.equal(judgment.decision, 'pass')
  assert.equal(judgment.reason, '新结论')
})

test('a planner decision accepts Chinese anchors and fills actionRequired', () => {
  const judgment = gateSubmissionOf([{
    name: 'mcp__lodge_gate__submit_decision',
    input: JSON.stringify({ decision: '交给人', reason: '权限只能你定' }),
  }], { type: 'planner' })
  assert.equal(judgment.type, 'planner')
  assert.equal(judgment.decision, 'human')
  assert.equal(judgment.actionRequired, '权限只能你定')
})

test('a verdict submission is not reused as a planner decision', () => {
  assert.equal(gateSubmissionOf([verdict()], { type: 'planner' }), null)
  assert.equal(gateSubmissionOf([], { type: 'verdict' }), null)
  assert.equal(gateSubmissionOf(null), null)
})

test('another MCP server cannot submit a room judgment', () => {
  assert.equal(gateSubmissionOf([{
    name: 'mcp__other__submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: 'not ours' }),
  }], { type: 'verdict' }), null)
})

test('gate judgments need a recognized decision and a reason', () => {
  assert.equal(judgmentFromGate({ type: 'verdict', input: { decision: 'maybe', reason: 'x' } }), null)
  assert.equal(judgmentFromGate({ type: 'verdict', input: { decision: 'PASS', reason: '   ' } }), null)
  assert.equal(judgmentFromGate({ type: 'verdict', input: null }), null)
})
