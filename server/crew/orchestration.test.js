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

test('only pipeline is registered; unknown orchestration is rejected', () => {
  assert.deepEqual(listOrchestrations().map(item => item.id), ['pipeline'])
  assert.equal(resolveOrchestration('swarm'), null)
  assert.equal(resolveOrchestration(''), resolveOrchestration())
  assert.equal(resolveOrchestration('pipeline').id, 'pipeline')
  assert.equal(reviewGuidanceFor(), '')
})

test('planDispatch filters to eligible workers', () => {
  const plan = planDispatch({
    stage: { assignees: ['ghost', 'executor-2'] },
    workers: ['executor', 'executor-2'],
  })
  assert.equal(plan.strategy.id, 'pipeline')
  assert.deepEqual(plan.assignees, ['executor-2'])
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
