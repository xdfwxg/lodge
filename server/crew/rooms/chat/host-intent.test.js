import assert from 'node:assert/strict'
import test from 'node:test'
import { hostIntentPrompt, parseHostIntent } from './host-intent.js'
import { setCurrentHumanName } from '../../human-name.js'

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

test('a truncated JSON envelope is recovered instead of shown raw', () => {
  const raw = '{"action":"reply","reply":"几个能落笔的观点：\\n\\n一是别在句子上跟它比绵密，往往因'
  const intent = parseHostIntent(raw, { speakers: [] })
  assert.equal(intent.action, 'reply')
  assert.equal(intent.structured, false)
  assert.match(intent.reply, /几个能落笔的观点/)
  assert.match(intent.reply, /\n\n/)
  assert.doesNotMatch(intent.reply, /\{"action"/)
  assert.match(intent.reply, /…$/)
})

test('the host prompt caps reply length', () => {
  const prompt = hostIntentPrompt({ room: { lodge: true, members: [] }, text: '继续', turnLimit: 6 })
  assert.match(prompt, /reply 不超过 200 字/)
})

test('Lodge decides to open a room in the same turn', () => {
  assert.deepEqual(
    parseHostIntent('{"action":"open","room":"chat","goal":"一起评价短篇《开锁》","reply":"我开一间让大伙看看。"}', { allowOpen: true }),
    {
      action: 'open',
      room: 'chat',
      goal: '一起评价短篇《开锁》',
      reply: '我开一间让大伙看看。',
      speakers: [],
      structured: true,
    },
  )
  assert.equal(parseHostIntent('{"action":"open","room":"chat"}', { allowOpen: true }).goal, '')
  assert.equal(parseHostIntent('{"action":"open","room":"panel"}', { allowOpen: true }).action, 'reply')
  assert.equal(parseHostIntent('{"action":"open","room":"chat"}', { allowOpen: false }).action, 'reply')
})

test('the Lodge prompt carries linked room status and conclusions', () => {
  const prompt = hostIntentPrompt({
    room: { lodge: true, members: [] },
    text: '然后呢',
    turnLimit: 6,
    linkedRooms: [{ name: '评价故事', status: '已有结论', conclusion: '开头好，结尾太急。' }],
  })
  assert.match(prompt, /从这里开出去的房/)
  assert.match(prompt, /评价故事：已有结论；最后结论：开头好，结尾太急。/)
  assert.match(prompt, /直接接着结论说/)
})

test('the Lodge prompt asks for a room decision instead of a round', () => {
  const prompt = hostIntentPrompt({ room: { lodge: true, members: [] }, text: '喊上大伙看看', turnLimit: 6 })
  assert.match(prompt, /"action":"open"/)
  assert.match(prompt, /"goal":"要完成的事"/)
  assert.match(prompt, /不要把“找人一起评/)
  assert.doesNotMatch(prompt, /"action":"round"/)
  assert.match(prompt, /open studio/)
  assert.match(prompt, /open chat/)
  // 身份和判断规则在主持人的 soul 里，判断提示不重复。
  assert.doesNotMatch(prompt, /听清楚|自动追问|分流|收束/)
})

test('the per-turn prompt carries this turn, not the host identity', () => {
  const prompt = hostIntentPrompt({ room: { members: [] }, text: '继续', turnLimit: 6 })
  // 身份在主提示里；每轮只说这次要什么。
  assert.doesNotMatch(prompt, /你是 Lodge 主持|负责接住用户的话/)
  assert.doesNotMatch(prompt, /Lodge 的主持人/)
})

test('a grill request stays with the host, one question at a time', () => {
  const prompt = hostIntentPrompt({ room: { members: [] }, text: '拷问我这个想法', turnLimit: 6 })
  assert.match(prompt, /一次只问一个/)
  assert.match(prompt, /不要开轮/)
  assert.match(prompt, /\"action\":\"reply\"/)
})

test('the host prompt tells the model the user name instead of only using it as a label', () => {
  setCurrentHumanName('千寻')
  const prompt = hostIntentPrompt({
    room: { lodge: true, members: [] },
    text: '我是谁',
    turnLimit: 6,
  })
  assert.match(prompt, /用户称呼：千寻/)
  assert.match(prompt, /千寻说：我是谁/)
  assert.doesNotMatch(prompt, /不要再问/)
  setCurrentHumanName('')
})

test('the host model decides the round without keyword overrides', () => {
  const prompt = hostIntentPrompt({
    room: { members: [{ id: 'a', name: '甲' }] },
    text: '不要讨论没用的，直接让大家说说',
    turnLimit: 6,
  })
  assert.match(prompt, /不要讨论没用的，直接让大家说说/)
  assert.doesNotMatch(prompt, /明确拒绝开轮/)
  assert.equal(parseHostIntent('{"action":"round","speakers":["a"],"reply":"好"}', { speakers: ['a'] }).action, 'round')
})

test('the host prompt lets the model choose a round only on an explicit request', () => {
  const prompt = hostIntentPrompt({
    room: { members: [{ id: 'a', name: '甲' }] },
    text: '大家说说',
    turnLimit: 6,
  })
  assert.match(prompt, /"action":"round"/)
  assert.match(prompt, /明确要求再讨论/)
  assert.match(prompt, /拿不准就 reply/)
  assert.match(prompt, /"action":"reply"/)
})
