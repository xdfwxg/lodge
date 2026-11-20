import assert from 'node:assert/strict'
import test from 'node:test'
import { issuesOf } from './room-issues.js'
import { retroOf } from './room-retro.js'

test('studio stages become issues without a second state', () => {
  const issues = issuesOf({
    roomType: 'studio',
    stages: [
      { title: '实现', state: 'passed', acceptance: 'npm test' },
      { title: '复核', state: 'active' },
      { title: '交付', state: 'pending' },
    ],
  })
  assert.deepEqual(issues.map(issue => [issue.id, issue.state]), [
    ['stage-0', 'done'],
    ['stage-1', 'in_progress'],
    ['stage-2', 'todo'],
  ])
})

test('chat conclusions become one decision and their todos', () => {
  const issues = issuesOf({
    roomType: 'chat',
    chat: { phase: 'concluded' },
  }, [{
    kind: 'chat_conclusion',
    text: '## 主题\n导出\n## 待办\n- 补一个导出按钮\n- 无',
  }])
  assert.deepEqual(issues.map(issue => [issue.kind, issue.state, issue.title]), [
    ['decision', 'done', '这轮结论'],
    ['todo', 'todo', '补一个导出按钮'],
  ])
})

test('a live chat discussion is an in-progress issue, not a guess', () => {
  assert.deepEqual(issuesOf({ roomType: 'chat', chat: { phase: 'discussing' } }).map(issue => issue.state), ['in_progress'])
})

test('room retro only reports real friction', () => {
  const empty = retroOf({ roomType: 'studio' }, [])
  assert.equal(empty.items.length, 0)
  assert.match(empty.summary, /没有明显摩擦/)

  const retro = retroOf({ roomType: 'studio' }, [
    { kind: 'rework', text: '验收没通过' },
    { kind: 'rework', text: '又没通过' },
  ])
  assert.equal(retro.items[0].kind, 'rework')
  assert.match(retro.items[0].text, /2 次/)
})
