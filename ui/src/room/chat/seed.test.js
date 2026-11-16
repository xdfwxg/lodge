import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStudioSeed } from './seed.js'
import { seedGoalText } from '../seed-text.js'

test('a chat conclusion becomes a structured handoff instead of a raw transcript', () => {
  const seed = chatStudioSeed({
    room: { id: 'room-chat', goal: '讨论交付边界', name: '圆桌' },
    conclusion: '先验最小闭环。',
  })
  assert.equal(seed.goal, '讨论交付边界')
  assert.equal(seed.conclusion, '先验最小闭环。')
  assert.equal(seed.sourceName, '圆桌')
  assert.equal(seed.sourceRoomId, 'room-chat')
  assert.deepEqual(seed.handoff, {
    topic: '讨论交付边界',
    consensus: ['先验最小闭环。'],
    disagreements: [],
    constraints: [],
    todos: [],
  })
  assert.equal(seedGoalText(seed), '讨论交付边界')
})

test('a structured conclusion keeps the five handoff fields', () => {
  const seed = chatStudioSeed({
    room: { goal: '发布讨论', name: '发布会' },
    conclusion: '## 共识\n- 先做最小版本\n## 分歧\n- 是否回滚\n## 待办\n- 写清单',
  })
  assert.equal(seed.handoff.consensus[0], '先做最小版本')
  assert.equal(seed.handoff.disagreements[0], '是否回滚')
  assert.equal(seed.handoff.todos[0], '写清单')
  assert.equal(seedGoalText(seed), '发布讨论')
  assert.equal(seed.handoff.consensus[0], '先做最小版本')
  assert.equal(seed.handoff.disagreements[0], '是否回滚')
})

test('a stored handoff wins over parsing the conclusion text again', () => {
  const handoff = {
    topic: '已存主题',
    consensus: ['已存共识'],
    disagreements: ['已存分歧'],
    constraints: [],
    todos: [],
  }
  const seed = chatStudioSeed({
    room: { goal: '房间目标', name: '圆桌' },
    conclusion: '## 主题\n文本主题\n## 共识\n- 文本共识',
    handoff,
  })
  assert.deepEqual(seed.handoff, handoff)
  assert.equal(seed.goal, '已存主题')
})

test('a return-to-chat seed uses its own context label', () => {
  assert.equal(
    seedGoalText({ goal: '评审这次交付', conclusion: '检查通过', label: '这次交付' }),
    '评审这次交付\n\n这次交付：\n检查通过',
  )
})

test('a receipt seed carries the four receipt fields into the goal', () => {
  const text = seedGoalText({
    goal: '评审这次交付：发布检查',
    label: '这次交付',
    receipt: {
      result: '发布检查',
      completeness: '2/2 步完成',
      checks: ['npm test 通过'],
      openQuestions: [],
    },
  })
  assert.match(text, /评审这次交付：发布检查/)
  assert.match(text, /完成度：2\/2 步完成/)
  assert.match(text, /检查：npm test 通过/)
})

test('the seeded goal is clipped before it reaches room creation', () => {
  const text = seedGoalText({ goal: 'g', conclusion: 'x'.repeat(3000) })
  assert.equal(text.length, 2000)
})
