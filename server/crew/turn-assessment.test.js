import assert from 'node:assert/strict'
import test from 'node:test'
import { assessTurn } from './turn-assessment.js'

test('an empty turn says what is missing and suggests the human boundary', () => {
  const assessment = assessTurn({
    outcome: 'empty',
    turn: { turnId: 't1', durationMs: 1200, reply: '', toolCalls: 0, hookCoverage: 'none' },
  })
  assert.deepEqual(assessment.evidence, ['耗时 1.2s'])
  assert.deepEqual(assessment.unknown, [
    '没有观察到工具调用',
    '回复为空',
    '没有用量记录',
    '没有 hook 覆盖，工具调用可能不完整',
  ])
  assert.deepEqual(assessment.next, ['检查续接或重开记录；必要时交给人'])
})

test('an evidence turn lists tools, evidence, assignment and usage', () => {
  const assessment = assessTurn({
    outcome: 'evidence',
    turn: {
      turnId: 't2',
      durationMs: 3400,
      reply: 'done',
      toolCalls: 3,
      tools: [{ name: 'bash', count: 2 }, { name: 'read', count: 1, failed: 1 }],
      usage: { input: 10, output: 5, costUsd: 0.002 },
      hookCoverage: 'hooks',
    },
    extra: { evidenceIds: ['e1'], assignmentId: 'a1' },
  })
  assert.deepEqual(assessment.evidence, [
    '耗时 3.4s',
    '工具调用 3 次：bash×2、read×1',
    '失败工具：read',
    '证据：e1',
    '交接：a1',
    '用量：输入 10 / 输出 5',
  ])
  assert.deepEqual(assessment.unknown, [])
  assert.deepEqual(assessment.next, ['核对证据和交接状态，等待验收'])
})

test('an unknown cost stays unknown, not zero', () => {
  const assessment = assessTurn({
    outcome: 'review',
    turn: {
      turnId: 't3',
      reply: 'PASS',
      toolCalls: 1,
      tools: [{ name: 'bash', count: 1 }],
      usage: { input: 1, output: 1, costUsd: null },
      hookCoverage: 'hooks',
    },
  })
  assert.ok(assessment.unknown.includes('费用未知'))
  assert.equal(assessment.unknown.includes('没有用量记录'), false)
})

test('a stale turn points at the new handoff', () => {
  const assessment = assessTurn({
    outcome: 'stale',
    turn: { turnId: 't4', reply: 'old', toolCalls: 1 },
    extra: { startedAt: 100, sentAt: 200 },
  })
  assert.deepEqual(assessment.next, ['确认新回合的交接时间与 turnId'])
})
