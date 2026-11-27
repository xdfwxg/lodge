import assert from 'node:assert/strict'
import test from 'node:test'
import { invariantViolations, projectionDrift, stuckDeliverableStage, studioFindings } from './state-guard.js'

const room = (over = {}) => ({
  roomType: 'studio',
  status: 'active',
  plan: { stages: [{ title: '实现' }] },
  stages: [{ title: '目标对齐', kind: 'decision', state: 'passed' }, { title: '实现', kind: 'deliverable', state: 'active' }],
  members: [{ id: 'lead', role: 'lead' }, { id: 'worker', role: 'worker' }],
  workspace: { capabilities: {} },
  ...over,
})

test('a healthy round has no structural violations', () => {
  assert.deepEqual(invariantViolations(room()), [])
})

test('two active stages are refused by the invariant', () => {
  const stages = [
    { title: '实现', kind: 'deliverable', state: 'active' },
    { title: '验收', kind: 'deliverable', state: 'active' },
  ]
  assert.match(invariantViolations(room({ stages })).join('；'), /多个进行中/)
})

test('a terminal round may not keep an active stage', () => {
  const stages = [{ title: '实现', kind: 'deliverable', state: 'active' }]
  assert.match(invariantViolations(room({ status: 'completed', stages })).join('；'), /已经结束/)
})

test('every plan stage must exist in the round', () => {
  const plan = { stages: [{ title: '实现' }, { title: '验收' }] }
  assert.match(invariantViolations(room({ plan })).join('；'), /没有落到轮次状态/)
})

test('one planner and one desktop executor at most', () => {
  assert.match(invariantViolations(room({ members: [{ role: 'lead' }, { role: 'lead' }] })).join('；'), /多个规划师/)
  const desktop = room({
    workspace: { capabilities: { desktop: true } },
    members: [{ role: 'lead' }, { role: 'worker' }, { role: 'worker' }],
  })
  assert.match(invariantViolations(desktop).join('；'), /多位执行官/)
})

test('a passed stage without an evidence fact is drift, not a structural violation', () => {
  const stages = [{ title: '实现', kind: 'deliverable', state: 'passed' }]
  const ctx = room({ stages })
  assert.deepEqual(invariantViolations(ctx), [])
  assert.match(projectionDrift(ctx, []).join('；'), /没有这一步的结果证据/)
  assert.deepEqual(projectionDrift(room({ stages }), [{ kind: 'evidence', meta: { stage: 0 } }]), [])
})

test('findings combine both', () => {
  const stages = [{ title: '实现', kind: 'deliverable', state: 'passed' }]
  const findings = studioFindings({ room: room({ stages }), messages: [] })
  assert.equal(findings.drift.length, 1)
  assert.deepEqual(findings.violations, [])
})


test('a stopped round is resumable, so its active stage is not a violation', () => {
  const room = {
    roomType: 'studio',
    status: 'stopped',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
  }
  assert.deepEqual(invariantViolations(room), [])
  // 真正结束的轮次仍不能挂着进行中的阶段。
  assert.ok(invariantViolations({ ...room, status: 'completed' }).length > 0)
})

test('an active stage with nothing in flight is reported as stuck', () => {
  const now = 10_000_000
  const base = {
    roomType: 'studio',
    state: 'active',
    lastProgressAt: now - 10 * 60_000,
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }, { title: '验收', kind: 'decision', state: 'pending' }],
    assignments: [],
    approvals: [],
  }
  assert.equal(stuckDeliverableStage(base, { now }), 0)
  // 有交接在跑、有卡在等人、被挡住、刚有进展，都不算卡住。
  assert.equal(stuckDeliverableStage({ ...base, assignments: [{ stageIndex: 0, status: 'working' }] }, { now }), null)
  assert.equal(stuckDeliverableStage({ ...base, approvals: [{ state: 'pending' }] }, { now }), null)
  assert.equal(stuckDeliverableStage({ ...base, blocked: { stage: 0 } }, { now }), null)
  assert.equal(stuckDeliverableStage({ ...base, lastProgressAt: now - 1000 }, { now }), null)
  // 已经交回、等整合的也算在跑。
  assert.equal(stuckDeliverableStage({ ...base, assignments: [{ stageIndex: 0, status: 'reported' }] }, { now }), null)
})
