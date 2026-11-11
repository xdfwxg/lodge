import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeatHandoff } from './seat-handoff.js'

const room = {
  id: 'room-h1',
  goal: '给设置页加保存',
  plan: { done: ['设置项列全', '保存后刷新仍生效'] },
  stages: [{ title: '实现', state: 'active' }],
  constraints: ['不改上游', '验收命令：npm test'],
  projectConstraints: { source: 'LODGE.md', content: '# 约定\n- 用 ESM\n- 组件不引外部状态库\n' },
}

test('a seat handoff carries business material and references the transcript', () => {
  const text = buildSeatHandoff({
    room,
    messages: [
      { kind: 'verdict', text: 'REJECT：少一个设置项', meta: { pass: false, stage: 0 } },
      { kind: 'verdict', text: 'PASS：保存后刷新仍生效', meta: { pass: true, stage: 1 } },
    ],
  })
  assert.match(text, /房间目标：给设置页加保存/)
  assert.match(text, /设置项列全/)
  assert.match(text, /不改上游/)
  assert.match(text, /项目约束（LODGE.md 快照）/)
  assert.match(text, /用 ESM/)
  assert.match(text, /REJECT：少一个设置项/)
  assert.match(text, /\.crew\/rooms\/room-h1\/transcript\.jsonl（2 条）/)
  assert.doesNotMatch(text, /# 约定/)
})

test('a seat handoff stays bounded', () => {
  const text = buildSeatHandoff({
    room: { ...room, constraints: Array.from({ length: 200 }, (_, index) => `约束 ${index} ${'x'.repeat(400)}`) },
    messages: [],
  })
  assert.equal(text.length <= 2_900, true)
  assert.match(text, /交接包已截断/)
})
