import assert from 'node:assert/strict'
import test from 'node:test'
import { coverageClausesOf, coverageGapsOf, coverageRequirementsOf } from './coverage.js'

const room = (done, stages) => ({ plan: { done }, stages })

const outcomes = [
  { id: 'export', statement: '导出能用', observable: '点导出会下载 CSV' },
  { id: 'docs', statement: '有一页说明', observable: 'README 能照着做' },
]
const contractRoom = stages => ({ plan: { contract: { outcomes } }, stages })

test('a contract stage covers the outcomes named by its clause ids', () => {
  const current = contractRoom([{ clauseIds: ['export'] }, { clauseIds: ['docs'] }])
  assert.deepEqual(coverageClausesOf({ room: current, stageIndex: 0 }), [outcomes[0]])
  assert.deepEqual(coverageClausesOf({ room: current, stageIndex: 1 }), [outcomes[1]])
})

test('a contract stage without clause ids falls back to every outcome', () => {
  assert.deepEqual(coverageClausesOf({ room: contractRoom([{}]), stageIndex: 0 }), outcomes)
})

test('contract coverage matches the clause id, not similar text', () => {
  const requirements = coverageClausesOf({ room: contractRoom([{ clauseIds: ['export'] }]), stageIndex: 0 })
  assert.deepEqual(coverageGapsOf({
    requirements,
    coverage: [{ clauseId: 'export', item: '导出能用', evidence: '点了导出，下载到 CSV' }],
  }), [])
  assert.deepEqual(coverageGapsOf({
    requirements,
    coverage: [{ item: '导出能用', evidence: '点了导出，下载到 CSV' }],
  }), requirements)
})

test('an intermediate stage only needs its own deliverable', () => {
  const current = room(['整轮能跑'], [
    { title: '目标对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'active', deliverable: '导出按钮能用' },
    { title: '补文档', kind: 'deliverable', state: 'pending', deliverable: '写一页说明' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ])
  assert.deepEqual(coverageRequirementsOf({ room: current, stageIndex: 1 }), ['导出按钮能用'])
})

test('the last work stage also covers every done condition', () => {
  const current = room(['导出能点', '说明能照着操作'], [
    { title: '目标对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'passed', deliverable: '导出按钮能用' },
    { title: '补文档', kind: 'deliverable', state: 'active', deliverable: '写一页说明' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ])
  assert.deepEqual(coverageRequirementsOf({ room: current, stageIndex: 2 }), [
    '写一页说明',
    '导出能点',
    '说明能照着操作',
  ])
})

test('coverage matches exact text, copied prefixes and punctuation variants', () => {
  const requirements = ['导出按钮能用', '说明能照着操作']
  assert.deepEqual(coverageGapsOf({
    requirements,
    coverage: [
      { item: '交付物：导出按钮能用。', evidence: '读了 src/export.js' },
      { item: '说明能照着操作', evidence: '照着 README 走了一遍' },
    ],
  }), [])
  assert.deepEqual(coverageGapsOf({
    requirements,
    coverage: [{ item: '导出按钮能用', evidence: '读了 src/export.js' }],
  }), ['说明能照着操作'])
})

test('an empty coverage table cannot silently pass a requirement', () => {
  assert.deepEqual(coverageGapsOf({ requirements: ['导出按钮能用'], coverage: [] }), ['导出按钮能用'])
  assert.deepEqual(coverageGapsOf({ requirements: ['导出按钮能用'], coverage: null }), ['导出按钮能用'])
})
