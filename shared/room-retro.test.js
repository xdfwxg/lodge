import assert from 'node:assert/strict'
import test from 'node:test'
import { retroOf } from './room-retro.js'

const studio = (patch = {}) => ({ roomType: 'studio', ...patch })

test('a clean studio has no friction', () => {
  const retro = retroOf(studio(), [])
  assert.deepEqual(retro.items, [])
  assert.equal(retro.summary, '这次没有明显摩擦')
})

test('reworks quote the latest reason', () => {
  const retro = retroOf(studio(), [
    { kind: 'rework', text: '测试没过' },
    { kind: 'message', text: '继续' },
    { kind: 'rework', text: '少了一个边界' },
  ])
  assert.equal(retro.items[0].kind, 'rework')
  assert.match(retro.items[0].text, /重做 2 次：少了一个边界/)
  assert.match(retro.items[0].suggestion, /验收/)
})

test('timeouts and a failed auto check are separate items', () => {
  const retro = retroOf(studio({ autoCheck: { status: 'blocked' } }), [{ kind: 'review_timeout' }])
  assert.deepEqual(retro.items.map(item => item.kind), ['timeout', 'check'])
})

test('studio retro keeps at most three items', () => {
  const retro = retroOf(studio({ autoCheck: { status: 'limit-reached' } }), [
    { kind: 'rework', text: 'a' },
    { kind: 'review_timeout' },
  ])
  assert.equal(retro.items.length, 3)
})

test('chat retro only mentions rounds and the turn limit', () => {
  const retro = retroOf({ roomType: 'chat', chat: { round: 3, turns: 6, turnLimit: 6 } }, [])
  assert.deepEqual(retro.items.map(item => item.kind), ['rounds', 'turns'])
  assert.equal(retro.mode, 'chat')
})

test('a single chat round with spare turns has no friction', () => {
  const retro = retroOf({ roomType: 'chat', chat: { round: 1, turns: 2, turnLimit: 6 } }, [])
  assert.deepEqual(retro.items, [])
})
