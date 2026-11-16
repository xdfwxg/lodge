import assert from 'node:assert/strict'
import test from 'node:test'
import { chatStudioSeed } from './seed.js'
import { seedGoalText } from '../seed-text.js'

test('a stored handoff becomes the studio seed', () => {
  const handoff = {
    topic: '发布讨论',
    consensus: ['先做最小版本'],
    disagreements: ['是否回滚'],
    constraints: [],
    todos: ['写清单'],
  }
  const seed = chatStudioSeed({
    room: { id: 'room-chat', goal: '房间目标', name: '圆桌' },
    conclusion: '完整结论原文',
    handoff,
  })
  assert.equal(seed.goal, '发布讨论')
  assert.equal(seed.conclusion, '完整结论原文')
  assert.equal(seed.sourceName, '圆桌')
  assert.equal(seed.sourceRoomId, 'room-chat')
  assert.deepEqual(seed.handoff, handoff)
  assert.equal(seedGoalText(seed), '发布讨论')
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
