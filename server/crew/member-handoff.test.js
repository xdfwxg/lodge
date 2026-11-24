import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemberHandoff } from './rooms/studio/member-handoff.js'
import { setCurrentHumanName } from './human-name.js'

const room = {
  id: 'room-h1',
  goal: '给设置页加保存',
  plan: { done: ['设置项列全', '保存后刷新仍生效'] },
  stages: [{ title: '实现', state: 'active' }],
  constraints: ['不改上游', '验收命令：npm test'],
  projectConstraints: { source: 'LODGE.md', content: '# 约定\n- 用 ESM\n- 组件不引外部状态库\n' },
}

test('a member handoff carries business material and references the transcript', () => {
  const text = buildMemberHandoff({
    room,
    messages: [
      { kind: 'verdict', text: 'REJECT：少一个设置项', meta: { pass: false, stage: 0 } },
      { kind: 'verdict', text: 'PASS：保存后刷新仍生效', meta: { pass: true, stage: 1 } },
    ],
  })
  assert.match(text, /房间目标：给设置页加保存/)
  assert.match(text, /设置项列全/)
  assert.match(text, /不改上游/)
  assert.match(text, /通过：保存后刷新仍生效/)
  assert.doesNotMatch(text, /少一个设置项/)
  assert.match(text, /\.crew\/rooms\/room-h1\/transcript\.jsonl（2 条）/)
  assert.doesNotMatch(text, /# 约定/)
})

test('a member sees their own room experience, not everyone else’s', () => {
  const messages = [
    { kind: 'evidence', authorId: 'w1', seq: 1, text: '改了设置页', meta: { stage: 0 } },
    { kind: 'verdict', authorId: 'v1', seq: 2, text: 'REJECT：少了设置项', meta: { pass: false, stage: 0 } },
  ]
  const worker = buildMemberHandoff({ room, messages, memberId: 'w1' })
  assert.match(worker, /你在这个房间的经历/)
  assert.match(worker, /第 1 步你交付后，验收不通过：少了设置项/)
  const verifier = buildMemberHandoff({ room, messages, memberId: 'v1' })
  assert.match(verifier, /第 1 步你给的判定：不通过/)
  const outsider = buildMemberHandoff({ room, messages, memberId: 'w2' })
  assert.doesNotMatch(outsider, /你在这个房间的经历/)
})

test('the handoff tells the member who the user is', () => {
  setCurrentHumanName('千寻')
  const text = buildMemberHandoff({ room, messages: [] })
  assert.match(text, /用户称呼：千寻/)
  setCurrentHumanName('')
})

test('the handoff lists the room members and their roles', () => {
  const text = buildMemberHandoff({
    room: {
      ...room,
      members: [
        { name: '小林', role: 'lead' },
        { name: '阿青', role: 'worker' },
        { name: '阿岚', role: 'verifier' },
      ],
    },
    messages: [],
  })
  assert.ok(text.includes('小林（规划师：只读，负责计划、派活、决策和收尾）'))
  assert.ok(text.includes('阿青（执行官：可读写、可执行，负责实现、测试和交付）'))
  assert.ok(text.includes('阿岚（验收员：只读，负责复核、挑问题和给结论）'))
})

test('shared memory brings the last rejection reasons along', () => {
  const text = buildMemberHandoff({
    room: {
      ...room,
      sharedMemory: [{
        goal: '给设置页加保存',
        conclusion: '已交付',
        files: ['src/settings.js'],
        rejections: [{ stage: 1, reason: '保存后刷新会丢设置' }],
      }],
    },
    messages: [],
  })
  assert.match(text, /工作区既有结论/)
  assert.match(text, /当时改过：src\/settings\.js/)
  assert.match(text, /上次被退回（阶段 2）：保存后刷新会丢设置/)
})

test('old memory is clipped before the current room facts', () => {
  const text = buildMemberHandoff({
    room: {
      ...room,
      sharedMemory: Array.from({ length: 3 }, (_, index) => ({
        goal: `旧目标 ${index}`,
        conclusion: '旧结论'.repeat(200),
        files: ['src/old.js'],
        rejections: [{ stage: 0, reason: '旧退回'.repeat(100) }],
      })),
    },
    messages: [],
  })
  assert.match(text, /进度：/)
  assert.match(text, /下一步：实现/)
  assert.equal(text.indexOf('进度：') < text.indexOf('工作区既有结论'), true)
})

test('a member handoff stays bounded', () => {
  const text = buildMemberHandoff({
    room: { ...room, constraints: Array.from({ length: 200 }, (_, index) => `约束 ${index} ${'x'.repeat(400)}`) },
    messages: [],
  })
  assert.equal(text.length <= 1_900, true)
  assert.match(text, /交接包已截断/)
})
