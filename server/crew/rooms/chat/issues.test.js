import assert from 'node:assert/strict'
import test from 'node:test'
import { chatIssuesOf, chatRetroOf } from './issues.js'

test('chat conclusions become one decision and their todos', () => {
  const issues = chatIssuesOf({ chat: { phase: 'concluded' } }, [{
    kind: 'chat_conclusion',
    text: '## 主题\n导出\n## 待办\n- 补一个导出按钮\n- 无',
  }])
  assert.deepEqual(issues.map(issue => [issue.kind, issue.state, issue.title]), [
    ['decision', 'done', '这轮结论'],
    ['todo', 'todo', '补一个导出按钮'],
  ])
})

test('a live chat discussion is an in-progress issue, not a guess', () => {
  assert.deepEqual(chatIssuesOf({ chat: { phase: 'discussing' } }).map(issue => issue.state), ['in_progress'])
})

test('chat retro only mentions rounds and the turn limit', () => {
  const retro = chatRetroOf({ chat: { round: 3, turns: 6, turnLimit: 6 } })
  assert.deepEqual(retro.items.map(item => item.kind), ['rounds', 'turns'])
  assert.equal(retro.mode, 'chat')
})

test('a single chat round with spare turns has no friction', () => {
  assert.deepEqual(chatRetroOf({ chat: { round: 1, turns: 2, turnLimit: 6 } }).items, [])
})
