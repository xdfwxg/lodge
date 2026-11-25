import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePlan, normalizeRequest, resolveMembers } from './input.js'
import { resolveRoomType } from '../kinds.js'

const body = stages => ({ plan: { done: ['结果能核对'], stages } })

test('every stage names what it delivers, not how to verify it', () => {
  const missing = normalizePlan({ body: body([{ title: '实现' }]) })
  assert.match(missing.error, /缺少交付物/)
  const planned = normalizePlan({ body: body([{ title: '实现', deliverable: '导出按钮能用' }]) })
  assert.equal(planned.error, undefined)
  assert.equal(planned.plan.stages[0].deliverable, '导出按钮能用')
  assert.equal('acceptance' in planned.plan.stages[0], false)
})

test('a supplied contract derives done and clause ids from its outcomes', () => {
  const planned = normalizePlan({
    body: {
      plan: {
        contract: {
          outcomes: [{ id: 'out', statement: '导出按钮能用', observable: '点导出会下载 CSV' }],
          boundaries: ['只改导出'],
        },
        stages: [{ title: '实现', deliverable: '导出按钮能用' }],
      },
    },
  })
  assert.equal(planned.error, undefined)
  assert.deepEqual(planned.plan.done, ['导出按钮能用'])
  assert.deepEqual(planned.plan.stages[0].clauseIds, ['out'])
  assert.deepEqual(planned.plan.contract.outcomes.map(item => item.id), ['out'])
})

test('stage packages keep files but no planner-written check', () => {
  const planned = normalizePlan({
    body: body([{ title: '实现', deliverable: '导出按钮能用', packages: [{ title: '导出', files: ['src/a.js'], check: 'npm test' }] }]),
  })
  assert.deepEqual(planned.plan.stages[0].packages, [{ title: '导出', files: ['src/a.js'] }])
})

test('studio roots carry a project north star without a phase chain', () => {
  const root = normalizeRequest({ goal: '做一个长期问候库', roomType: 'studio', verify: 'manual' })
  assert.deepEqual(root.project, { northStar: '做一个长期问候库' })
  assert.equal(root.phase, undefined)
  assert.equal(root.continuation, undefined)
})

test('a studio room can start with a chosen planner and no crew', () => {
  const request = {
    goal: '把说明写清楚',
    roomType: 'studio',
    members: [{ role: 'lead', name: '规划师', engine: 'claude', model: 'planner-model' }],
  }
  const normalized = normalizeRequest(request)
  assert.equal(normalized.error, undefined)
  assert.equal(normalized.bootstrap, true)
  const members = resolveMembers(request, resolveRoomType('studio'), { bootstrap: normalized.bootstrap })
  assert.deepEqual(members.roster.map(member => member.role), ['lead'])
  assert.equal(members.lead.engine, 'claude')
  assert.equal(members.lead.model, 'planner-model')
  assert.equal(members.bootstrap, true)
})
