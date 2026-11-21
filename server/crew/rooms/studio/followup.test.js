import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFollowupBody } from './followup.js'

const room = over => ({
  id: 'room-1',
  name: '设置页保存',
  goal: '给设置页加保存',
  roomType: 'studio',
  state: 'complete',
  repoPath: '/work/room-1/executor',
  sourceRepo: '/work/project',
  generation: 1,
  completedCommit: 'abc123',
  stages: [
    { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
    { title: '验收与结论', kind: 'decision', state: 'passed' },
  ],
  gate: { verification: { mode: 'test', command: 'npm test' } },
  members: [
    { id: 'planner', name: '规划师', role: 'lead', body: { engine: 'claude', model: 'sonnet', spec: { prompt: '规划' } } },
    { id: 'executor', name: '执行官', role: 'worker', body: { engine: 'claude', model: 'sonnet' } },
    { id: 'verifier', name: '验收员', role: 'verifier', body: { engine: 'pi', model: 'deepseek' } },
  ],
  ...over,
})

test('a delivered room turns one sentence into a linked next version', () => {
  const built = buildFollowupBody({
    room: room(),
    messages: [
      { kind: 'verdict', text: 'PASS', meta: { reason: '保存后刷新仍生效' } },
      { kind: 'evidence', meta: { changedFiles: ['src/settings.js', 'src/settings.js'] } },
    ],
    text: '把保存按钮改成圆角',
  })
  assert.equal(built.error, undefined)
  assert.equal(built.body.goal, '把保存按钮改成圆角')
  assert.equal(built.body.name, '设置页保存 · 第 2 版')
  assert.equal(built.body.verify, 'manual')
  assert.equal(built.body.acceptance, undefined)
  assert.deepEqual(built.body.project, { northStar: '给设置页加保存' })
  assert.deepEqual(built.body.phase, { name: '把保存按钮改成圆角', index: 2 })
  assert.equal(built.body.repoPath, '/work/room-1/executor')
  assert.deepEqual(built.body.members.map(item => [item.role, item.name, item.engine]), [
    ['lead', '规划师', 'claude'],
    ['worker', '执行官', 'claude'],
    ['verifier', '验收员', 'pi'],
  ])
  assert.deepEqual(built.body.continuation, {
    fromRoomId: 'room-1',
    fromRoomName: '设置页保存',
    version: 2,
    goal: '给设置页加保存',
    conclusion: '保存后刷新仍生效',
    files: ['src/settings.js'],
    check: 'npm test',
    commit: 'abc123',
    at: built.body.continuation.at,
  })
})

test('an unfinished room reworks in place instead of opening a version', () => {
  const result = buildFollowupBody({ room: room({ state: 'active', stages: [{ state: 'active' }] }), text: '改一下' })
  assert.match(result.error, /还没交付/)
})

test('the next phase can carry its own command contract', () => {
  const built = buildFollowupBody({
    room: room({ project: { northStar: '把设置页做成可发布的版本' }, phase: { name: '保存', index: 3 } }),
    text: '阶段 4：补上导出',
    verify: 'test',
    acceptance: 'node --test test/export.test.js',
  })
  assert.deepEqual(built.body.project, { northStar: '把设置页做成可发布的版本' })
  assert.deepEqual(built.body.phase, { name: '补上导出', index: 4 })
  assert.equal(built.body.verify, 'test')
  assert.equal(built.body.acceptance, 'node --test test/export.test.js')
})

test('a room without a check carries manual acceptance', () => {
  const built = buildFollowupBody({
    room: room({ gate: { verification: { mode: 'manual' } }, stages: [{ state: 'passed' }] }),
    text: '补一句说明',
  })
  assert.equal(built.body.verify, 'manual')
  assert.equal(built.body.acceptance, undefined)
})

test('an empty follow-up is refused', () => {
  assert.match(buildFollowupBody({ room: room(), text: '  ' }).error, /说一句/)
})
