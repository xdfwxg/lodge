import assert from 'node:assert/strict'
import test from 'node:test'
import { askedForRound, ensureRoundWhenAsked, parseHostIntent } from './host-intent.js'

test('a host reply stays a reply', () => {
  assert.deepEqual(
    parseHostIntent('{"action":"reply","reply":"我在，先说你的判断。"}', { speakers: ['a'] }),
    { action: 'reply', reply: '我在，先说你的判断。', speakers: [], structured: true },
  )
})

test('a host round only keeps fixed speakers and caps at three', () => {
  const intent = parseHostIntent('{"action":"round","speakers":["a","b","c","d","x"],"reply":"我请三位说说。"}', {
    speakers: ['a', 'b', 'c', 'd'],
  })
  assert.deepEqual(intent, {
    action: 'round',
    reply: '我请三位说说。',
    speakers: ['a', 'b', 'c'],
    structured: true,
  })
})

test('a round without a valid speaker falls back to a reply', () => {
  const intent = parseHostIntent('{"action":"round","speakers":["nobody"],"reply":"我叫人来。"}', { speakers: ['a'] })
  assert.equal(intent.action, 'reply')
  assert.equal(intent.reply, '我叫人来。')
})

test('non-JSON host output still shows as text', () => {
  assert.deepEqual(parseHostIntent('我先听听你的判断。', { speakers: [] }), {
    action: 'reply',
    reply: '我先听听你的判断。',
    speakers: [],
    structured: false,
  })
})

test('an explicit request for another round is recognised', () => {
  assert.equal(askedForRound('再走一轮：这轮把周六晚的取舍定下来。'), true)
  assert.equal(askedForRound('大家说说看'), true)
  assert.equal(askedForRound('你怎么看？'), false)
  assert.equal(askedForRound(''), false)
})

test('an explicit round request turns a plain reply into a round', () => {
  const room = { members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }
  const reply = { action: 'reply', reply: '再来一轮，就一个点。', speakers: [], structured: true }
  assert.deepEqual(ensureRoundWhenAsked(reply, '再来一轮，就一个点：今晚定不定。', room), {
    action: 'round',
    reply: '再来一轮，就一个点。',
    speakers: ['a', 'b', 'c'],
    structured: true,
  })
  assert.equal(ensureRoundWhenAsked(reply, '你怎么看？', room).action, 'reply')
  assert.equal(ensureRoundWhenAsked({ ...reply, action: 'round' }, '再来一轮', room).action, 'round')
})
