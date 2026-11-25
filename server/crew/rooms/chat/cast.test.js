import assert from 'node:assert/strict'
import test from 'node:test'
import { castPrompt, fallbackCast, openingOf, parseCast } from './cast.js'

const members = [
  { id: 'a', name: '老周', lens: '这轮只看值不值得做。' },
  { id: 'b', name: '小林', lens: '这轮只找会坏的地方。' },
  { id: 'c', name: '阿岚', lens: '' },
  { id: 'd', name: '大陈', lens: '这轮只算成本。' },
]

test('a cast keeps known ids in order and drops duplicates and strangers', () => {
  const parsed = parseCast(JSON.stringify({
    cast: [
      { id: 'b', focus: '这轮只看成本' },
      { id: 'b', focus: '重复' },
      { id: 'zz', focus: '不在班底' },
      { id: 'c', focus: '' },
    ],
    why: '只看成本和使用场景',
  }), { members })
  assert.deepEqual(parsed, {
    cast: [{ id: 'b', focus: '这轮只看成本' }, { id: 'c', focus: '' }],
    why: '只看成本和使用场景',
  })
})

test('a cast with fewer than two people falls back', () => {
  assert.equal(parseCast('{"cast":[{"id":"a","focus":"x"}]}', { members }), null)
  assert.equal(parseCast('不是 JSON', { members }), null)
  assert.equal(parseCast('```json\n{"cast":[{"id":"a"},{"id":"b"}]}\n```', { members }).cast.length, 2)
})

test('a cast never exceeds six people', () => {
  const many = Array.from({ length: 9 }, (_, index) => ({ id: `m${index}`, name: `成员${index}` }))
  const parsed = parseCast(JSON.stringify({ cast: many.map(item => ({ id: item.id, focus: '' })) }), { members: many })
  assert.equal(parsed.cast.length, 6)
})

test('the opening card names the guest and their focus for tonight', () => {
  const text = openingOf({
    members,
    cast: [
      { id: 'a', focus: '这轮只看值不值得做' },
      { id: 'c', focus: '' },
    ],
    why: '先定方向',
  })
  assert.equal(text, '今晚请到 2 位：老周看值不值得做，阿岚（先定方向）')
})

test('the fallback cast takes the first three from the bank', () => {
  const fallback = fallbackCast(members)
  assert.deepEqual(fallback.cast.map(item => item.id), ['a', 'b', 'c'])
  assert.equal(fallback.cast[0].focus, '这轮只看值不值得做。')
})

test('the cast prompt names the bank and asks for JSON', () => {
  const prompt = castPrompt({ room: { goal: '下个版本先做什么' }, members })
  assert.match(prompt, /话题：下个版本先做什么/)
  assert.match(prompt, /最多 6 位，最少 2 位/)
  assert.match(prompt, /老周/)
  assert.match(prompt, /固定问题：这轮只看值不值得做/)
  assert.match(prompt, /\{"cast":\[\{"id":"成员id","focus"/)
})
