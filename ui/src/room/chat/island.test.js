import assert from 'node:assert/strict'
import test from 'node:test'
import { chatIslandGoal } from './island.js'

const goalOf = chat => chatIslandGoal({ id: 'room-chat', name: '圆桌', goal: '讨论交付边界', state: 'active', chat })

test('a discussing chat says it is chatting, without a second task', () => {
  const goal = goalOf({ phase: 'discussing' })
  assert.deepEqual(goal.stages.map(stage => stage.title), ['聊天'])
  assert.deepEqual(goal.stages.map(stage => stage.status), ['active'])
  assert.equal(goal.kind, 'chat')
  assert.equal(goal.current, 0)
  assert.equal(goal.barLabel, '正在聊')
  assert.equal(goal.idle, false)
})

test('a concluded chat stops here instead of waiting for a conclusion', () => {
  const goal = goalOf({ phase: 'awaiting_decision' })
  assert.equal(goal.barLabel, '聊到这儿了')
  assert.equal(goal.stages[0].status, 'active')
  assert.equal(goal.idle, false)
})

test('an accepted chat reads as finished, not as delivered', () => {
  const goal = goalOf({ phase: 'accepted' })
  assert.equal(goal.barLabel, '聊完了')
  assert.equal(goal.status, 'complete')
})

test('the goal keeps the room name and the original topic', () => {
  const goal = goalOf({ phase: 'discussing' })
  assert.equal(goal.title, '圆桌')
  assert.equal(goal.objective, '讨论交付边界')
})
