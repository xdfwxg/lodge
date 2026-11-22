import assert from 'node:assert/strict'
import test from 'node:test'
import { studioIssuesOf, studioRetroOf } from './issues.js'

test('studio stages become issues without a second state', () => {
  const issues = studioIssuesOf({
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

test('a clean studio has no friction', () => {
  const retro = studioRetroOf({}, [])
  assert.deepEqual(retro.items, [])
  assert.equal(retro.summary, '这次没有明显摩擦')
})

test('reworks quote the latest reason', () => {
  const retro = studioRetroOf({}, [
    { kind: 'rework', text: '测试没过' },
    { kind: 'message', text: '继续' },
    { kind: 'rework', text: '少了一个边界' },
  ])
  assert.equal(retro.items[0].kind, 'rework')
  assert.match(retro.items[0].text, /重做 2 次：少了一个边界/)
  assert.match(retro.items[0].suggestion, /验收/)
})

test('timeouts and a failed auto check are separate items', () => {
  const retro = studioRetroOf({ autoCheck: { status: 'blocked' } }, [{ kind: 'review_timeout' }])
  assert.deepEqual(retro.items.map(item => item.kind), ['timeout', 'check'])
})

test('studio retro keeps at most three items', () => {
  const retro = studioRetroOf({ autoCheck: { status: 'limit-reached' } }, [
    { kind: 'rework', text: 'a' },
    { kind: 'review_timeout' },
  ])
  assert.equal(retro.items.length, 3)
})
