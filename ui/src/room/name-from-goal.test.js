import assert from 'node:assert/strict'
import test from 'node:test'
import { roomNameFromGoal } from './name-from-goal.js'

test('room names come from the first meaningful line of the goal', () => {
  assert.equal(roomNameFromGoal('兰香如故这部剧太好看了'), '兰香如故这部剧太好看了')
  assert.equal(roomNameFromGoal('目标：修复登录页保存\n\n验收：npm test'), '修复登录页保存')
  assert.equal(roomNameFromGoal('结论：值得看，但更值得讨论的是人物动机是否自洽。'), '值得看，但更值得讨论的是人物动机是否自洽。')
  assert.equal(roomNameFromGoal('【简历优化】'), '简历优化')
  assert.equal(roomNameFromGoal('  \n\n第二行才是目标'), '第二行才是目标')
  assert.equal(roomNameFromGoal(''), '')
})

test('long goals are clipped to a title', () => {
  const name = roomNameFromGoal('把简历优化工坊的导出按钮做成可选格式并补上端到端验收用例')
  assert.equal(Array.from(name).length, 25)
  assert.match(name, /…$/)
})
