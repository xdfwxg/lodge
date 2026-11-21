import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePlan, normalizeRequest, runnableCheck } from './input.js'

const body = stages => ({ plan: { done: ['结果能核对'], stages } })

test('a deliverable stage needs a runnable command, not a sentence', () => {
  const prose = normalizePlan({ body: body([{ title: '实现', kind: 'deliverable', acceptance: '看起来没问题' }]) })
  assert.match(prose.error, /能跑的命令/)
  assert.equal(normalizePlan({ body: body([{ title: '实现', kind: 'deliverable', acceptance: 'npm test' }]) }).error, undefined)
  assert.equal(normalizePlan({ body: body([{ title: '实现', kind: 'deliverable', acceptance: './scripts/check.sh' }]) }).error, undefined)
  assert.equal(normalizePlan({ body: body([{ title: '实现', kind: 'deliverable', acceptance: 'test -f out/a.png' }]) }).error, undefined)
})

test('decision stages and manual sign-off need no command', () => {
  assert.equal(normalizePlan({ body: body([{ title: '确认方向', kind: 'decision' }]) }).error, undefined)
  assert.equal(normalizePlan({ body: body([{ title: '导出', kind: 'deliverable', acceptance: 'manual' }]) }).error, undefined)
})

test('studio roots carry a project north star and phase label', () => {
  const root = normalizeRequest({ goal: '做一个长期问候库', roomType: 'studio', verify: 'manual' })
  assert.deepEqual(root.project, { northStar: '做一个长期问候库' })
  assert.deepEqual(root.phase, { name: '阶段 1', index: null })

  const next = normalizeRequest({
    goal: '补上命令行',
    roomType: 'studio',
    verify: 'manual',
    sourceRoomId: 'room-1',
    project: { northStar: '做一个长期问候库' },
    phase: { name: '补上命令行', index: 2 },
  })
  assert.deepEqual(next.project, { northStar: '做一个长期问候库' })
  assert.deepEqual(next.phase, { name: '补上命令行', index: 2 })
})

test('runnableCheck reads the first word as the command', () => {
  assert.equal(runnableCheck('node --test'), true)
  assert.equal(runnableCheck('cd ui && npm run build'), true)
  assert.equal(runnableCheck('/usr/bin/env bash check.sh'), true)
  assert.equal(runnableCheck('done'), false)
  assert.equal(runnableCheck('检查一下页面'), false)
  assert.equal(runnableCheck(''), false)
})
