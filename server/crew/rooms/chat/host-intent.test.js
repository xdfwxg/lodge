import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeHostIntent, hostIntentPrompt, parseHostIntent, roundVetoed } from './host-intent.js'
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

test('only an explicit refusal vetoes the host round', () => {
  for (const text of [
    '先不继续讨论了',
    '不要再走一轮',
    '不用大家说说',
    '没必要开一轮',
    '先别讨论一轮',
    '我不觉得需要继续讨论',
    '不要多说一轮',
    '别再讨论了',
  ]) {
    assert.equal(roundVetoed(text), true, text)
  }
  for (const text of [
    '先不继续讨论了，但大家说说',
    '我不反对大家说说',
    '不用等太久就直接再走一轮',
    '不过大家说说',
    '特别大家说说',
    '你怎么看？',
    '',
  ]) {
    assert.equal(roundVetoed(text), false, text)
  }
})

test('a refusal is an admission fact in the prompt, not a post-hoc guess', () => {
  const vetoed = hostIntentPrompt({
    room: { members: [] },
    text: '先不继续讨论了',
    turnLimit: 6,
    roundAllowed: false,
  })
  assert.match(vetoed, /明确拒绝开轮/)
  assert.match(vetoed, /只许 reply/)
  const normal = hostIntentPrompt({ room: { members: [] }, text: '继续', turnLimit: 6 })
  assert.doesNotMatch(normal, /明确拒绝开轮/)
})

test('the host model decides a round; only an explicit refusal downgrades it', () => {
  const modelRound = { action: 'round', reply: '我请人来说。', speakers: ['a', 'b'], structured: true }
  const modelReply = { action: 'reply', reply: '我先说说。', speakers: [], structured: true }
  assert.equal(finalizeHostIntent(modelRound, '咱们继续把这事聊透').action, 'round')
  assert.equal(finalizeHostIntent(modelRound, '你怎么看？').action, 'round')
  assert.equal(finalizeHostIntent(modelRound, '不要再走一轮').action, 'reply')
  assert.equal(finalizeHostIntent(modelReply, '再来一轮').action, 'reply')
})

test('a vetoed round without a reply still says something', () => {
  const empty = finalizeHostIntent(
    { action: 'round', reply: '', speakers: ['a'], structured: true },
    '不要再走一轮',
  )
  assert.deepEqual(empty, {
    action: 'reply',
    reply: '好，那这次先不开了。',
    speakers: [],
    structured: true,
  })
  const kept = finalizeHostIntent(
    { action: 'round', reply: '那就不开。', speakers: ['a'], structured: true },
    '不要再走一轮',
  )
  assert.equal(kept.reply, '那就不开。')
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
