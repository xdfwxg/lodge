import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeContract } from './contract.js'

test('a contract keeps observable outcomes and stable ids', () => {
  const contract = normalizeContract({
    outcomes: [
      { id: 'export', statement: '导出按钮能用', observable: '点导出会下载 CSV' },
      { statement: '文案说清楚', observable: 'README 里有三节' },
    ],
    boundaries: ['只改导出'],
    nonGoals: ['不做移动端'],
    assumptions: ['仓库可写'],
  })
  assert.equal(contract.version, 1)
  assert.deepEqual(contract.outcomes.map(item => item.id), ['export', 'o2'])
  assert.equal(contract.outcomes[0].observable, '点导出会下载 CSV')
  assert.deepEqual(contract.boundaries, ['只改导出'])
})

test('an outcome without a statement or observable signal is dropped', () => {
  assert.equal(normalizeContract({ outcomes: [{ statement: '能跑' }] }), null)
  assert.equal(normalizeContract({ outcomes: [] }), null)
  assert.equal(normalizeContract(null), null)
})

test('duplicate ids are made unique instead of overwriting', () => {
  const contract = normalizeContract({
    outcomes: [
      { id: 'same', statement: 'A', observable: 'a' },
      { id: 'same', statement: 'B', observable: 'b' },
    ],
  })
  assert.deepEqual(contract.outcomes.map(item => item.id), ['same', 'same-2'])
})

test('an empty contract is not a contract', () => {
  assert.equal(normalizeContract({ boundaries: ['x'] }), null)
})
