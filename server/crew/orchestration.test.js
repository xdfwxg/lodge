import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultOrchestrationId, listOrchestrations, planDispatch, resolveAssigneeTokens, resolveOrchestration, reviewGuidanceFor } from './orchestration/index.js'

const workers = ['executor', 'executor-2']

test('pipeline is the default and dispatches one proposed worker', () => {
  const strategy = resolveOrchestration(undefined)
  assert.equal(strategy.id, defaultOrchestrationId)
  assert.equal(strategy.id, 'pipeline')
  assert.deepEqual(strategy.planStage({ stage: { assignees: ['executor-2'] }, workers }), {
    assignees: ['executor-2'],
    parallel: false,
    note: '',
  })
  assert.deepEqual(strategy.planStage({ stage: {}, workers }).assignees, ['executor'])
  assert.match(
    strategy.planStage({ stage: { assignees: ['executor', 'executor-2'] }, workers }).note,
    /一次只派一个/,
  )
})

test('parallel dispatches every worker and degrades honestly with one seat', () => {
  const strategy = resolveOrchestration('parallel')
  assert.deepEqual(strategy.planStage({ stage: {}, workers }), {
    assignees: ['executor', 'executor-2'],
    parallel: true,
    note: '',
  })
  const single = strategy.planStage({ stage: {}, workers: ['executor'] })
  assert.equal(single.parallel, false)
  assert.match(single.note, /至少两个执行席位/)
})

test('parallel respects a smaller proposed set', () => {
  const strategy = resolveOrchestration('parallel')
  const plan = strategy.planStage({ stage: { assignees: ['executor'] }, workers })
  assert.deepEqual(plan.assignees, ['executor'])
  assert.equal(plan.parallel, false)
})

test('critique keeps one dispatcher and adds adversarial review guidance', () => {
  const strategy = resolveOrchestration('critique')
  assert.equal(strategy.planStage({ stage: {}, workers }).assignees.length, 1)
  assert.match(strategy.reviewGuidance, /反例/)
  const listed = listOrchestrations().find(item => item.id === 'critique')
  assert.match(listed.reviewGuidance, /反例/)
})

test('unknown orchestration is rejected instead of silently falling back', () => {
  assert.equal(resolveOrchestration('swarm'), null)
  assert.equal(resolveOrchestration(''), resolveOrchestration())
  assert.equal(resolveOrchestration(' parallel ').id, 'parallel')
  assert.deepEqual(listOrchestrations().map(item => item.id), ['pipeline', 'parallel', 'critique'])
})

test('planDispatch filters to eligible workers and exposes review guidance', () => {
  const plan = planDispatch({
    room: { orchestration: 'pipeline' },
    stage: { assignees: ['ghost', 'executor-2'] },
    index: 0,
    workers: ['executor', 'executor-2'],
  })
  assert.equal(plan.strategy.id, 'pipeline')
  assert.deepEqual(plan.assignees, ['executor-2'])
  const parallel = planDispatch({ room: { orchestration: 'parallel' }, stage: {}, index: 0, workers: ['executor', 'executor-2'] })
  assert.equal(parallel.parallel, true)
  assert.deepEqual(parallel.assignees, ['executor', 'executor-2'])
  assert.match(reviewGuidanceFor({ orchestration: 'critique' }), /反例/)
  assert.equal(reviewGuidanceFor({ orchestration: 'pipeline' }), '')
})

test('planner assignee tokens resolve to workers only', () => {
  const roster = [
    { id: 'lead', name: '队长', role: 'lead' },
    { id: 'worker', name: '甲', role: 'worker' },
    { id: 'worker-2', name: '乙', role: 'worker' },
    { id: 'verifier', name: '验收员', role: 'verifier' },
  ]
  assert.deepEqual(resolveAssigneeTokens(['甲', 'worker-2', '验收员', '不存在'], roster), ['worker', 'worker-2'])
  assert.deepEqual(resolveAssigneeTokens(['队长'], roster), [])
  assert.deepEqual(resolveAssigneeTokens([], roster), [])
})
