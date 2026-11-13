import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStudioSeed, seedGoalText } from './chat-seed.js'

test('a chat conclusion becomes studio goal text only', () => {
  const seed = chatStudioSeed({
    room: { goal: '讨论交付边界', name: '圆桌' },
    conclusion: '先验最小闭环。',
  })
  assert.deepEqual(seed, { goal: '讨论交付边界', conclusion: '先验最小闭环。', sourceName: '圆桌' })
  assert.equal(seedGoalText(seed), '讨论交付边界\n\n聊天室结论：\n先验最小闭环。')
})

test('the seeded goal is clipped before it reaches room creation', () => {
  const text = seedGoalText({ goal: 'g', conclusion: 'x'.repeat(3000) })
  assert.equal(text.length, 2000)
})
