import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHostIntent } from './host-intent.js'

test('a host reply stays a reply', () => {
  assert.deepEqual(
    parseHostIntent('{"action":"reply","reply":"我在，先说你的判断。"}', { speakers: ['a'] }),
    { action: 'reply', reply: '我在，先说你的判断。', speakers: [] },
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
  })
})
