import assert from 'node:assert/strict'
import test from 'node:test'
import { replayChat } from './replay-chat.js'

const event = (type, at, payload = {}) => ({ type, payload, at })
const message = (seq, at, authorId, text, extra = {}) => ({
  seq, kind: 'chat', authorId, text, ts: at, ...extra,
})
const members = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]

test('replay answers who spoke in a round and where the conclusion came from', () => {
  const replay = replayChat({
    events: [
      event('chat.round_started', 1000, { round: 1, from: 0 }),
      event('chat.speaker', 1010, { memberId: 'a', turn: 1 }),
      event('chat.speaker', 1020, { memberId: 'b', turn: 2 }),
      event('chat.summary_started', 1030, { round: 1 }),
      event('chat.conclusion', 1040, { round: 1, fallback: false }),
    ],
    messages: [
      message(1, 1000, 'lodge', '【周末去哪】', { meta: { opening: true, round: 1 } }),
      message(2, 1010, 'a', '先去近的。'),
      message(3, 1020, 'b', '也可以再等等。'),
      {
        seq: 4,
        kind: 'chat_conclusion',
        authorId: 'lodge',
        text: '结论：周六去近郊。\n下一步：甲订票。',
        ts: 1040,
        meta: { round: 1, fallback: false, handoffBrief: { topic: '周末', todos: ['甲订票'] } },
      },
    ],
    members,
  })
  assert.equal(replay.rounds.length, 1)
  const round = replay.rounds[0]
  assert.equal(round.round, 1)
  assert.deepEqual(round.speakers.map(item => [item.name, item.turn, item.spoke]), [['甲', 1, true], ['乙', 2, true]])
  assert.deepEqual(round.messages.map(item => `${item.name}:${item.text}`), [
    '主持:【周末去哪】', '甲:先去近的。', '乙:也可以再等等。',
  ])
  assert.equal(round.conclusion.text, '结论：周六去近郊。\n下一步：甲订票。')
  assert.equal(round.conclusion.fallback, false)
  assert.deepEqual(round.conclusion.handoffBrief.todos, ['甲订票'])
  assert.deepEqual(round.warnings, [])
  assert.deepEqual(replay.warnings, [])
})

test('a continued round keeps its note and does not leak it into the previous round', () => {
  const replay = replayChat({
    events: [
      event('chat.round_started', 1000, { round: 1, from: 0 }),
      event('chat.speaker', 1010, { memberId: 'a', turn: 1 }),
      event('chat.summary_started', 1020, { round: 1 }),
      event('chat.conclusion', 1030, { round: 1, fallback: false }),
      event('chat.continued', 2000, { round: 2 }),
      event('chat.round_started', 2000, { round: 2, from: 0 }),
      event('chat.speaker', 2010, { memberId: 'b', turn: 1 }),
      event('chat.summary_started', 2020, { round: 2 }),
      event('chat.conclusion', 2030, { round: 2, fallback: false }),
    ],
    messages: [
      message(1, 1000, 'lodge', '【周末去哪】', { meta: { opening: true, round: 1 } }),
      message(2, 1010, 'a', '先去近的。'),
      { seq: 3, kind: 'chat_conclusion', authorId: 'lodge', text: '结论一。', ts: 1030, meta: { round: 1 } },
      { seq: 4, kind: 'chat_rework', authorId: 'you', text: '再讨论一轮：换个角度。', ts: 1999, meta: { round: 1 } },
      message(5, 2000, 'lodge', '【周末去哪】', { meta: { opening: true, round: 2 } }),
      message(6, 2010, 'b', '我再补一句。'),
      { seq: 7, kind: 'chat_conclusion', authorId: 'lodge', text: '结论二。', ts: 2030, meta: { round: 2 } },
    ],
    members,
  })
  assert.equal(replay.rounds.length, 2)
  assert.equal(replay.rounds[0].messages.some(item => item.kind === 'chat_rework'), false)
  assert.equal(replay.rounds[1].continued, true)
  assert.equal(replay.rounds[1].continuedFrom, 1)
  assert.equal(replay.rounds[1].note, '再讨论一轮：换个角度。')
  assert.equal(replay.rounds[1].conclusion.text, '结论二。')
})

test('replay reports gaps instead of inventing a conclusion', () => {
  const replay = replayChat({
    events: [
      event('chat.round_started', 1000, { round: 1, from: 0 }),
      event('chat.speaker', 1010, { memberId: 'a', turn: 1 }),
    ],
    messages: [message(1, 1000, 'lodge', '【周末去哪】', { meta: { opening: true, round: 1 } })],
    members,
  })
  const round = replay.rounds[0]
  assert.equal(round.conclusion, null)
  assert.equal(round.speakers[0].spoke, false)
  assert.ok(round.warnings.some(text => text.includes('甲 没有留下发言')))
  assert.ok(round.warnings.includes('这一轮还没有结论'))
})

test('a fallback conclusion is marked and explains why', () => {
  const replay = replayChat({
    events: [
      event('chat.round_started', 1000, { round: 1, from: 0 }),
      event('chat.speaker', 1010, { memberId: 'a', turn: 1 }),
      event('chat.summary_started', 1020, { round: 1 }),
      event('chat.conclusion', 1030, { round: 1, fallback: true }),
    ],
    messages: [
      message(1, 1000, 'lodge', '【周末去哪】', { meta: { opening: true, round: 1 } }),
      message(2, 1010, 'a', '先去近的。'),
      { seq: 3, kind: 'chat_conclusion', authorId: 'lodge', text: '大家倾向近郊。', ts: 1030, meta: { round: 1, fallback: true } },
    ],
    members,
  })
  assert.equal(replay.rounds[0].conclusion.fallback, true)
  assert.ok(replay.rounds[0].warnings.includes('结论是自动摘要：主持没有在时限内回应'))
})

test('a conclusion event without its message is a gap, not a guess', () => {
  const replay = replayChat({
    events: [
      event('chat.round_started', 1000, { round: 1, from: 0 }),
      event('chat.speaker', 1010, { memberId: 'a', turn: 1 }),
      event('chat.summary_started', 1020, { round: 1 }),
      event('chat.conclusion', 1030, { round: 1 }),
    ],
    messages: [
      message(1, 1000, 'lodge', '【周末去哪】', { meta: { opening: true, round: 1 } }),
      message(2, 1010, 'a', '先去近的。'),
    ],
    members,
  })
  assert.equal(replay.rounds[0].conclusion, null)
  assert.ok(replay.rounds[0].warnings.includes('有结论事件，但没有找到结论消息'))
})

test('no chat events returns a warning instead of an empty success', () => {
  const replay = replayChat({ events: [], messages: [], members })
  assert.deepEqual(replay.rounds, [])
  assert.ok(replay.warnings.includes('没有找到聊天事件'))
  assert.ok(replay.warnings.includes('没有找到聊天轮次'))
})
