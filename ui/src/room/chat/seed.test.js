import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStudioSeed } from './seed.js'
import { seedGoalText } from '../seed-text.js'

test('a chat conclusion becomes a structured handoff instead of a raw transcript', () => {
  const seed = chatStudioSeed({
    room: { goal: '讨论交付边界', name: '圆桌' },
    conclusion: '先验最小闭环。',
  })
  assert.equal(seed.goal, '讨论交付边界')
  assert.equal(seed.conclusion, '先验最小闭环。')
  assert.equal(seed.sourceName, '圆桌')
  assert.deepEqual(seed.handoff, {
    topic: '讨论交付边界',
    consensus: ['先验最小闭环。'],
    disagreements: [],
    constraints: [],
    todos: [],
  })
  assert.equal(seedGoalText(seed), '讨论交付边界\n共识：先验最小闭环。')
})

test('a structured conclusion keeps the five handoff fields', () => {
  const seed = chatStudioSeed({
    room: { goal: '发布讨论', name: '发布会' },
    conclusion: '## 共识\n- 先做最小版本\n## 分歧\n- 是否回滚\n## 待办\n- 写清单',
  })
  assert.equal(seed.handoff.consensus[0], '先做最小版本')
  assert.equal(seed.handoff.disagreements[0], '是否回滚')
  assert.equal(seed.handoff.todos[0], '写清单')
  assert.match(seedGoalText(seed), /共识：先做最小版本/)
  assert.match(seedGoalText(seed), /分歧：是否回滚/)
})

test('a return-to-chat seed uses its own context label', () => {
  assert.equal(
    seedGoalText({ goal: '评审这次交付', conclusion: '检查通过', label: '这次交付' }),
    '评审这次交付\n\n这次交付：\n检查通过',
  )
})

test('the seeded goal is clipped before it reaches room creation', () => {
  const text = seedGoalText({ goal: 'g', conclusion: 'x'.repeat(3000) })
  assert.equal(text.length, 2000)
})
