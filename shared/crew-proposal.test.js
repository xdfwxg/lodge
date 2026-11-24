import assert from 'node:assert/strict'
import test from 'node:test'
import { executorsNeeded, independentPackagesOf, normalizeCrewProposal } from './crew-proposal.js'

const proposal = over => ({
  plan: {
    done: ['能跑'],
    stages: [{ title: '实现', deliverable: '导出按钮能用', packages: [{ title: 'a', files: ['src/a.js'] }] }],
  },
  crew: { executors: [{ engine: 'claude', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
  ...over,
})

test('a plan and crew normalize into bounded fields', () => {
  const result = normalizeCrewProposal({
    why: ' 先做最小版 ',
    assumptions: [' 根目录可写 ', ''],
    notDoing: [' 不做移动端 '],
    ...proposal(),
  })
  assert.equal(result.error, undefined)
  assert.equal(result.proposal.why, '先做最小版')
  assert.deepEqual(result.proposal.assumptions, ['根目录可写'])
  assert.deepEqual(result.proposal.notDoing, ['不做移动端'])
  assert.deepEqual(result.proposal.plan.stages[0].packages[0].files, ['src/a.js'])
  assert.equal(result.proposal.plan.stages[0].deliverable, '导出按钮能用')
  assert.equal('acceptance' in result.proposal.plan.stages[0], false)
})

test('a proposal without a stage, deliverable, executor or verifier fails closed', () => {
  assert.match(normalizeCrewProposal({ plan: { done: ['x'], stages: [{ title: '实现' }] }, crew: proposal().crew }).error, /阶段/)
  assert.match(normalizeCrewProposal({ plan: { done: ['x'], stages: [] }, crew: proposal().crew }).error, /阶段/)
  assert.match(normalizeCrewProposal({ plan: proposal().plan, crew: { executors: [], verifiers: [{ engine: 'pi', model: 'y' }] } }).error, /执行官/)
  assert.match(normalizeCrewProposal({ plan: proposal().plan, crew: { executors: [{ engine: 'claude', model: 'x' }] } }).error, /验收员/)
  assert.match(normalizeCrewProposal({ plan: proposal().plan, crew: { executors: [{ engine: 'claude', model: 'x', name: '同名' }], verifiers: [{ engine: 'pi', model: 'y', name: '同名' }] }, }).error, /重复/)
})

test('only disjoint file-bearing packages can run in parallel', () => {
  assert.equal(independentPackagesOf({ packages: [{ files: ['a'] }, { files: ['b'] }] }), 2)
  assert.equal(independentPackagesOf({ packages: [{ files: ['a'] }, { files: ['a'] }] }), 1)
  assert.equal(independentPackagesOf({ packages: [{ files: [] }, { files: ['b'] }] }), 1)
  assert.equal(independentPackagesOf({ packages: [{ files: ['a'] }] }), 1)
  // 先取大包会只剩 1 个；最大独立集是 a-only 和 b-only 两个。
  assert.equal(independentPackagesOf({ packages: [{ files: ['a', 'b'] }, { files: ['a'] }, { files: ['b'] }] }), 2)
  assert.equal(executorsNeeded([
    { packages: [{ files: ['a'] }, { files: ['b'] }] },
    { packages: [{ files: ['c'] }] },
  ]), 2)
})
