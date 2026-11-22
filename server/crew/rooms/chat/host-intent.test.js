import assert from 'node:assert/strict'
import test from 'node:test'
import { askedForRound, finalizeHostIntent, hostIntentPrompt, parseHostIntent } from './host-intent.js'

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

test('Lodge decides to open a room in the same turn', () => {
  assert.deepEqual(
    parseHostIntent('{"action":"open","room":"chat","reply":"我开一间让大伙看看。"}', { allowOpen: true }),
    { action: 'open', room: 'chat', reply: '我开一间让大伙看看。', speakers: [], structured: true },
  )
  assert.equal(parseHostIntent('{"action":"open","room":"panel"}', { allowOpen: true }).action, 'reply')
  assert.equal(parseHostIntent('{"action":"open","room":"chat"}', { allowOpen: false }).action, 'reply')
})

test('the Lodge prompt asks for a room decision instead of a round', () => {
  const prompt = hostIntentPrompt({ room: { lodge: true, members: [] }, text: '喊上大伙看看', turnLimit: 6 })
  assert.match(prompt, /"action":"open"/)
  assert.doesNotMatch(prompt, /"action":"round"/)
  assert.match(prompt, /open studio/)
  assert.match(prompt, /open chat/)
  // 身份和判断规则在主持人的 soul 里，判断提示不重复。
  assert.doesNotMatch(prompt, /听清楚|自动追问|分流|收束/)
})

test('a grill request stays with the host, one question at a time', () => {
  const prompt = hostIntentPrompt({ room: { members: [] }, text: '拷问我这个想法', turnLimit: 6 })
  assert.match(prompt, /一次只问一个/)
  assert.match(prompt, /不要开轮/)
  assert.match(prompt, /\"action\":\"reply\"/)
})

test('the host prompt tells the model the user name instead of only using it as a label', () => {
  const prompt = hostIntentPrompt({
    room: { lodge: true, members: [], humanName: '千寻' },
    text: '我是谁',
    turnLimit: 6,
  })
  assert.match(prompt, /用户称呼：千寻/)
  assert.match(prompt, /千寻说：我是谁/)
  assert.doesNotMatch(prompt, /不要再问/)
})

test('an explicit request for another round is recognised', () => {
  assert.equal(askedForRound('再走一轮：这轮把周六晚的取舍定下来。'), true)
  assert.equal(askedForRound('大家说说看'), true)
  assert.equal(askedForRound('你怎么看？'), false)
  assert.equal(askedForRound(''), false)
})

test('the host cannot open a round unless the user asked for one', () => {
  const room = { members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }
  const reply = { action: 'reply', reply: '再来一轮，就一个点。', speakers: [], structured: true }
  const modelRound = { action: 'round', reply: '我请人来说。', speakers: ['a', 'b'], structured: true }
  assert.deepEqual(finalizeHostIntent(reply, '再来一轮，就一个点：今晚定不定。', room), {
    action: 'round',
    reply: '再来一轮，就一个点。',
    speakers: ['a', 'b', 'c'],
    structured: true,
  })
  assert.equal(finalizeHostIntent(reply, '你怎么看？', room).action, 'reply')
  assert.equal(finalizeHostIntent(modelRound, '你怎么看？', room).action, 'reply')
  assert.equal(finalizeHostIntent(modelRound, '再来一轮', room).action, 'round')
})

test('the host prompt asks only for a reply', () => {
  const prompt = hostIntentPrompt({
    room: { members: [{ id: 'a', name: '甲' }] },
    text: '大家说说',
    turnLimit: 6,
  })
  assert.doesNotMatch(prompt, /"action":"round"/)
  assert.match(prompt, /不自己开轮/)
  assert.match(prompt, /"action":"reply"/)
})
