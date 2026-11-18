import assert from 'node:assert/strict'
import test from 'node:test'
import { chatIslandGoal } from './island.js'

const goalOf = chat => chatIslandGoal({ id: 'room-chat', name: '圆桌', goal: '讨论交付边界', state: 'active', chat })

test('a discussing chat stands on its first step', () => {
  const goal = goalOf({ phase: 'discussing' })
  assert.deepEqual(goal.stages.map(stage => stage.status), ['active', 'pending'])
  assert.equal(goal.current, 0)
})

test('a concluded chat moves to the conclusion step', () => {
  const goal = goalOf({ phase: 'awaiting_decision' })
  assert.deepEqual(goal.stages.map(stage => stage.status), ['passed', 'active'])
  assert.equal(goal.current, 1)
})

test('an accepted chat marks the conclusion as passed', () => {
  const goal = goalOf({ phase: 'accepted' })
  assert.deepEqual(goal.stages.map(stage => stage.status), ['passed', 'passed'])
  assert.equal(goal.current, 1)
})

test('the goal keeps the room name and the original topic', () => {
  const goal = goalOf({ phase: 'discussing' })
  assert.equal(goal.title, '圆桌')
  assert.equal(goal.objective, '讨论交付边界')
})
