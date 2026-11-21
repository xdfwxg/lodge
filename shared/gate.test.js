import test from 'node:test'
import assert from 'node:assert/strict'
import { gateSubmissionOf, isGateToolName, rewindRequestOf } from './gate.js'
import { judgmentFromGate } from './judgment.js'

const verdict = overrides => ({
  name: 'mcp__lodge_gate__submit_verdict',
  input: JSON.stringify({
    decision: 'PASS',
    reason: '文件内容和检查都对',
    outsideDiff: '无',
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

test('the base activity label with a single underscore is recognized', () => {
  const judgment = gateSubmissionOf([{
    name: 'lodge_gate_submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: 'base label', outsideDiff: '无' }),
  }], { type: 'verdict' })
  assert.equal(judgment.source, 'gate')
  assert.equal(judgment.decision, 'pass')
})

test('a PASS gate submission without an outside risk is not accepted', () => {
  assert.equal(gateSubmissionOf([verdict({ outsideDiff: '' })], { type: 'verdict' }), null)
  assert.equal(gateSubmissionOf([{
    name: 'mcp__lodge_gate__submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: '缺风险' }),
  }], { type: 'verdict' }), null)
})

test('another MCP server cannot submit a room judgment', () => {
  assert.equal(gateSubmissionOf([{
    name: 'mcp__other__submit_verdict',
    input: JSON.stringify({ decision: 'PASS', reason: 'not ours' }),
  }], { type: 'verdict' }), null)
})

test('only the lodge_gate tool names are recognized by the permission bridge', () => {
  assert.equal(isGateToolName('lodge_gate:submit_verdict'), true)
  assert.equal(isGateToolName('lodge_gate_submit_decision'), true)
  assert.equal(isGateToolName('mcp__lodge_gate__submit_verdict'), true)
  assert.equal(isGateToolName('Allow lodge_gate:submit_verdict?'), true)
  assert.equal(isGateToolName('mcp__other__submit_verdict'), false)
  assert.equal(isGateToolName('submit_verdict'), false)
})

test('a planner rewind request is 1-based and needs a note', () => {
  assert.deepEqual(
    rewindRequestOf([{
      name: 'mcp__lodge_gate__rewind_stage',
      input: JSON.stringify({ stage: 2, note: '方向错了' }),
    }]),
    { stage: 1, note: '方向错了' },
  )
  assert.equal(rewindRequestOf([{
    name: 'mcp__lodge_gate__rewind_stage',
    input: JSON.stringify({ stage: 0, note: '方向错了' }),
  }]), null)
  assert.equal(rewindRequestOf([{
    name: 'mcp__lodge_gate__rewind_stage',
    input: JSON.stringify({ stage: 1, note: ' ' }),
  }]), null)
})

test('gate judgments need a recognized decision and a reason', () => {
  assert.equal(judgmentFromGate({ type: 'verdict', input: { decision: 'maybe', reason: 'x' } }), null)
  assert.equal(judgmentFromGate({ type: 'verdict', input: { decision: 'PASS', reason: '   ' } }), null)
  assert.equal(judgmentFromGate({ type: 'verdict', input: null }), null)
})
