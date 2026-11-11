import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptanceChangeError } from './service.js'

test('an active deliverable cannot lose its acceptance command', () => {
  assert.deepEqual(
    acceptanceChangeError({ kind: 'deliverable', state: 'active', acceptance: 'npm test' }, ''),
    ['conflict', '进行中的交付型阶段不能清空验收命令；先暂停或停止'],
  )
})

test('a pending deliverable may clear its acceptance command', () => {
  assert.equal(acceptanceChangeError({ kind: 'deliverable', state: 'pending', acceptance: 'npm test' }, ''), null)
})

test('passed and non-deliverable stages cannot edit acceptance', () => {
  assert.equal(acceptanceChangeError({ kind: 'deliverable', state: 'passed' }, 'npm test')[0], 'conflict')
  assert.equal(acceptanceChangeError({ kind: 'decision', state: 'active' }, 'npm test')[0], 'invalid')
})
