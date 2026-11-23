import assert from 'node:assert/strict'
import test from 'node:test'
import { judgmentFromGate, normalizeJudgment } from './judgment.js'

test('a gate verdict keeps the protected files it acknowledged', () => {
  const judgment = judgmentFromGate({
    type: 'verdict',
    input: {
      decision: 'PASS',
      reason: '改好了',
      outsideDiff: '无',
      protectedFiles: ['./package.json', 'package.json', '.env'],
    },
  })
  assert.deepEqual(judgment.protectedFiles, ['package.json', '.env'])
})

test('a text verdict never claims protected files', () => {
  const judgment = normalizeJudgment({
    type: 'verdict',
    text: '通过\n```json\n{"reason":"好","outsideDiff":"无","protectedFiles":["package.json"]}\n```',
  })
  assert.deepEqual(judgment.protectedFiles, ['package.json'])
})
