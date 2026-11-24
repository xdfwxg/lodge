import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStudioSeed, returnToChatSeed, seedGoalText } from './room-seeds.js'

test('a stored handoffBrief becomes the studio seed', () => {
  const handoffBrief = {
    topic: '发布讨论',
    consensus: ['先做最小版本'],
    disagreements: ['是否回滚'],
    unknowns: ['还没跑回滚验证'],
    constraints: [],
    todos: ['写清单'],
  }
  const seed = chatStudioSeed({
    room: { id: 'room-chat', goal: '房间目标', name: '圆桌' },
    conclusion: '完整结论原文',
    handoffBrief,
  })
  assert.equal(seed.goal, '发布讨论')
  assert.equal(seed.conclusion, '完整结论原文')
  assert.equal(seed.sourceName, '圆桌')
  assert.equal(seed.sourceRoomId, 'room-chat')
  assert.deepEqual(seed.handoffBrief, handoffBrief)
  assert.equal(seedGoalText(seed), '发布讨论')
})

test('a return-to-chat seed uses its own context label', () => {
  assert.equal(
    seedGoalText({ goal: '评审这次做出来的', conclusion: '检查通过', label: '这次做出来的' }),
    '评审这次做出来的\n\n这次做出来的：\n检查通过',
  )
})

test('a receipt seed carries the four receipt fields into the goal', () => {
  const text = seedGoalText({
    goal: '评审这次做出来的：发布检查',
    label: '这次做出来的',
    receipt: {
      result: '发布检查',
      completeness: '2/2 步完成',
      checks: ['npm test 通过'],
      openQuestions: [],
    },
  })
  assert.match(text, /评审这次做出来的：发布检查/)
  assert.match(text, /完成度：2\/2 步完成/)
  assert.match(text, /检查：npm test 通过/)
})

test('the seeded goal is clipped before it reaches room creation', () => {
  const text = seedGoalText({ goal: 'g', conclusion: 'x'.repeat(3000) })
  assert.equal(text.length, 2000)
})

test('a finished delivery returns to chat as a structured receipt', () => {
  const seed = returnToChatSeed({
    id: 'room-studio',
    repoPath: '/Users/someone/CrewWorktrees/abc/executor',
    delivery: {
      name: '发布检查清单',
      goal: '让新人照着勾',
      stages: [{ state: 'passed' }, { state: 'passed' }],
      commands: [{ command: 'npm test', exit: 0 }, { command: 'npm run lint', exit: 0 }],
      changedFiles: ['RELEASE_CHECKLIST.md'],
      openQuestions: ['是否需要自动回滚？'],
    },
  })
  assert.equal(seed.goal, '评审这次做出来的：发布检查清单')
  assert.equal(seed.label, '这次做出来的')
  assert.equal(seed.sourceRoomId, 'room-studio')
  assert.equal(seed.repoPath, '/Users/someone/CrewWorktrees/abc/executor')
  assert.deepEqual(seed.receipt, {
    result: '发布检查清单',
    completeness: '2/2 步完成，1 个文件',
    checks: ['2/2 项检查通过'],
    paths: ['RELEASE_CHECKLIST.md'],
    openQuestions: ['是否需要自动回滚？'],
  })
  assert.match(seed.conclusion, /完成度：2\/2 步完成/)
  assert.match(seed.conclusion, /检查：2\/2 项检查通过/)
  assert.match(seed.conclusion, /文件：RELEASE_CHECKLIST\.md/)
  assert.match(seed.conclusion, /待确认：是否需要自动回滚？/)
})

test('a manual delivery still brings a receipt', () => {
  const seed = returnToChatSeed({
    id: 'room-manual',
    delivery: { name: '人工验收的交付', stages: [{ state: 'passed' }], commands: [], changedFiles: [] },
  })
  assert.equal(seed.receipt.completeness, '1/1 步完成')
  assert.deepEqual(seed.receipt.checks, ['人工验收通过'])
  assert.deepEqual(seed.receipt.openQuestions, [])
})

test('a room without a delivery cannot return to chat', () => {
  assert.equal(returnToChatSeed({ delivery: null }), null)
})
