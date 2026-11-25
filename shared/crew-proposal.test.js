import assert from 'node:assert/strict'
import test from 'node:test'
import { executorsNeeded, independentPackagesOf, normalizeCrewProposal } from './crew-proposal.js'

const contract = {
  outcomes: [{ id: 'export', statement: '导出按钮能用', observable: '点导出会下载 CSV' }],
  boundaries: ['只改导出'],
  nonGoals: ['不做移动端'],
  assumptions: ['仓库可写'],
}

const proposal = over => ({
  contract,
  plan: {
    stages: [{ title: '实现', deliverable: '导出按钮能用', clauseIds: ['export'], packages: [{ title: 'a', files: ['src/a.js'] }] }],
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
  assert.deepEqual(result.proposal.plan.stages[0].clauseIds, ['export'])
  assert.equal('acceptance' in result.proposal.plan.stages[0], false)
})

test('done is a projection of the contract, not a second input', () => {
  const result = normalizeCrewProposal({
    ...proposal(),
    plan: { ...proposal().plan, done: ['自己另写的完成条件'] },
  })
  assert.equal(result.error, undefined)
  assert.deepEqual(result.proposal.plan.done, ['导出按钮能用'])
})

test('a contract without boundaries or non-goals is rejected', () => {
  assert.match(normalizeCrewProposal({ ...proposal(), contract: { ...contract, boundaries: [] } }).error, /没有边界/)
  assert.match(normalizeCrewProposal({ ...proposal(), contract: { ...contract, nonGoals: [] } }).error, /没有非目标/)
})

test('every stage needs a package with files so the write boundary has a shape', () => {
  const noPackage = proposal()
  noPackage.plan.stages[0].packages = []
  assert.match(normalizeCrewProposal(noPackage).error, /没有工作包/)
  const noFiles = proposal()
  noFiles.plan.stages[0].packages = [{ title: 'a', files: [] }]
  assert.match(normalizeCrewProposal(noFiles).error, /没有文件/)
})

test('a stage can declare that it preserves behavior', () => {
  const result = normalizeCrewProposal({
    ...proposal(),
    plan: {
      stages: [{
        ...proposal().plan.stages[0],
        behavior: 'preserve',
      }],
    },
  })
  assert.equal(result.proposal.plan.stages[0].behavior, 'preserve')
  assert.equal(normalizeCrewProposal(proposal()).proposal.plan.stages[0].behavior, 'change')
})

test('every contract outcome must be assigned to a stage with an existing clause id', () => {
  const twoOutcomes = {
    ...contract,
    outcomes: [
      ...contract.outcomes,
      { id: 'docs', statement: '有一页说明', observable: 'README 能照着做' },
    ],
  }
  assert.match(normalizeCrewProposal({ ...proposal(), contract: twoOutcomes }).error, /没有分配到/)
  assert.match(normalizeCrewProposal({
    ...proposal(),
    plan: { stages: [{ title: '实现', deliverable: '能用', clauseIds: ['missing'] }] },
  }).error, /契约里没有/)
  assert.match(normalizeCrewProposal({
    ...proposal(),
    plan: { stages: [{ title: '实现', deliverable: '能用' }] },
  }).error, /阶段/)
})

test('a proposal without a contract, stage, deliverable, executor or verifier fails closed', () => {
  assert.match(normalizeCrewProposal({ plan: proposal().plan, crew: proposal().crew }).error, /契约/)
  assert.match(normalizeCrewProposal({ contract, plan: { stages: [{ title: '实现' }] }, crew: proposal().crew }).error, /阶段/)
  assert.match(normalizeCrewProposal({ contract, plan: { stages: [] }, crew: proposal().crew }).error, /阶段/)
  assert.match(normalizeCrewProposal({ contract, plan: proposal().plan, crew: { executors: [], verifiers: [{ engine: 'pi', model: 'y' }] } }).error, /执行官/)
  assert.match(normalizeCrewProposal({ contract, plan: proposal().plan, crew: { executors: [{ engine: 'claude', model: 'x' }] } }).error, /验收员/)
  assert.match(normalizeCrewProposal({ contract, plan: proposal().plan, crew: { executors: [{ engine: 'claude', model: 'x', name: '同名' }], verifiers: [{ engine: 'pi', model: 'y', name: '同名' }] }, }).error, /重复/)
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
