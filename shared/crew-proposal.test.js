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
    stages: [{ title: '实现', deliverable: '导出按钮能用', clauseIds: ['export'], packages: [{ title: 'a', files: ['src/a.js'], clauseIds: ['export'] }] }],
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

test('contract outcomes and clause references match regardless of case', () => {
  const result = normalizeCrewProposal({
    contract: { ...contract, outcomes: [{ id: 'C1', statement: '导出能用', observable: '点导出会下载 CSV' }] },
    plan: { stages: [{ title: '实现', deliverable: '能导出', clauseIds: ['C1'], packages: [{ title: 'a', files: ['src/a.js'], clauseIds: ['c1'] }] }] },
    crew: { executors: [{ engine: 'claude', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
  })
  assert.equal(result.error, undefined)
  assert.deepEqual(result.proposal.contract.outcomes.map(item => item.id), ['c1'])
  assert.deepEqual(result.proposal.plan.stages[0].clauseIds, ['c1'])
  assert.deepEqual(result.proposal.plan.stages[0].packages[0].clauseIds, ['c1'])
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
  noFiles.plan.stages[0].packages = [{ title: 'a', files: [], clauseIds: ['export'] }]
  assert.match(normalizeCrewProposal(noFiles).error, /没有文件/)
})

test('every package names the clauses it proves, and together they cover the stage', () => {
  const noClauses = proposal()
  noClauses.plan.stages[0].packages = [{ title: 'a', files: ['src/a.js'] }]
  assert.match(normalizeCrewProposal(noClauses).error, /没有 clauseIds/)

  const unknown = proposal()
  unknown.plan.stages[0].packages = [{ title: 'a', files: ['src/a.js'], clauseIds: ['missing'] }]
  assert.match(normalizeCrewProposal(unknown).error, /本阶段没有的要求/)

  const twoOutcomes = {
    ...contract,
    outcomes: [
      ...contract.outcomes,
      { id: 'docs', statement: '有一页说明', observable: 'README 能照着做' },
    ],
  }
  const uncovered = proposal()
  uncovered.contract = twoOutcomes
  uncovered.plan.stages[0].clauseIds = ['export', 'docs']
  uncovered.plan.stages[0].packages = [{ title: 'a', files: ['src/a.js'], clauseIds: ['export'] }]
  assert.match(normalizeCrewProposal(uncovered).error, /没有落到工作包/)
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

test('a malformed stage or crew member is rejected, never silently dropped', () => {
  const stage = { title: '实现', deliverable: '能用', clauseIds: ['export'], packages: [{ title: 'a', files: ['src/a.js'], clauseIds: ['export'] }] }
  const droppedStage = proposal()
  droppedStage.plan.stages = [stage, { title: '收尾', clauseIds: ['export'], packages: [{ title: 'b', files: ['src/b.js'], clauseIds: ['export'] }] }]
  assert.match(normalizeCrewProposal(droppedStage).error, /第 2 个阶段/)
  const droppedExecutor = proposal()
  droppedExecutor.crew.executors.push({ engine: '', model: 'x' })
  assert.match(normalizeCrewProposal(droppedExecutor).error, /执行官缺 engine\/model/)
  const droppedVerifier = proposal()
  droppedVerifier.crew.verifiers.push({ engine: 'claude', model: '' })
  assert.match(normalizeCrewProposal(droppedVerifier).error, /验收员缺 engine\/model/)
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

test('a clause that names a file proves it only after the stage that writes it', () => {
  // 真房（第 31 轮）：规划师把「lodge-proof.json 可重跑」这条要求放在第 2 步，
  // 但第 2 步的工作包只写 hello.txt 和 tools/check.mjs——执行商照包写，验收员按契约判不通过，白跑一轮。
  const twoStages = plan => ({
    contract: {
      outcomes: [
        { id: 'hello', statement: 'hello.txt 存在', observable: 'cat hello.txt 有内容' },
        { id: 'proof', statement: 'lodge-proof.json 的 entry 能跑', observable: '跑 entry 退出 0' },
      ],
      boundaries: ['只改这些文件'],
      nonGoals: ['不装依赖'],
      assumptions: ['仓库可写'],
    },
    plan: { stages: plan },
    crew: { executors: [{ engine: 'pi', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
  })
  const misplaced = normalizeCrewProposal(twoStages([
    {
      title: '落文件',
      deliverable: 'hello.txt 与证明',
      clauseIds: ['hello', 'proof'],
      packages: [{ title: 'a', files: ['hello.txt'], clauseIds: ['hello', 'proof'] }],
    },
    {
      title: '证明',
      deliverable: 'lodge-proof.json',
      clauseIds: ['proof'],
      packages: [{ title: 'b', files: ['lodge-proof.json'], clauseIds: ['proof'] }],
    },
  ]))
  assert.match(misplaced.error, /第 1 步的契约要求「proof」提到 lodge-proof\.json/)
  assert.match(misplaced.error, /要到第 2 步才写/)

  // 同一条要求放在写它的那一步就没事；提到别的目录里的文件也不算错。
  const placed = normalizeCrewProposal(twoStages([
    { title: '落文件', deliverable: 'hello.txt', clauseIds: ['hello'], packages: [{ title: 'a', files: ['hello.txt'], clauseIds: ['hello'] }] },
    { title: '证明', deliverable: 'lodge-proof.json', clauseIds: ['proof'], packages: [{ title: 'b', files: ['lodge-proof.json'], clauseIds: ['proof'] }] },
  ]))
  assert.equal(placed.error, undefined)
})

test('a package may cover a directory, not just an exact path', () => {
  const result = normalizeCrewProposal({
    contract: {
      outcomes: [{ id: 'checker', statement: 'tools/check.mjs 能跑', observable: 'node tools/check.mjs 退出 0' }],
      boundaries: ['只改 tools'],
      nonGoals: ['不装依赖'],
      assumptions: ['仓库可写'],
    },
    plan: {
      stages: [{ title: '实现', deliverable: '检查器', clauseIds: ['checker'], packages: [{ title: 'a', files: ['tools'], clauseIds: ['checker'] }] }],
    },
    crew: { executors: [{ engine: 'pi', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
  })
  assert.equal(result.error, undefined)
})
