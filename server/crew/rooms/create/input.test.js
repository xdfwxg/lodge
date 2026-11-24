import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePlan, normalizeRequest } from './input.js'

const body = stages => ({ plan: { done: ['结果能核对'], stages } })

test('every stage names what it delivers, not how to verify it', () => {
  const missing = normalizePlan({ body: body([{ title: '实现' }]) })
  assert.match(missing.error, /缺少交付物/)
  const planned = normalizePlan({ body: body([{ title: '实现', deliverable: '导出按钮能用' }]) })
  assert.equal(planned.error, undefined)
  assert.equal(planned.plan.stages[0].deliverable, '导出按钮能用')
  assert.equal('acceptance' in planned.plan.stages[0], false)
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
