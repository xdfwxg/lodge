import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatConclusionCard } from './conclusion-card.js'

const room = over => ({
  goal: '讨论状态提示',
  state: 'active',
  chat: { round: 1 },
  ...over,
})

const message = over => ({
  kind: 'chat_conclusion',
  text: '## 主题\n状态提示\n## 共识\n- 用一句话说明',
  meta: { round: 1 },
  ...over,
})

const render = (messageValue, roomValue = room()) => renderToStaticMarkup(h(ChatConclusionCard, {
  message: messageValue,
  seat: { name: 'Lodge 主持' },
  room: roomValue,
}))

test('a structured conclusion renders all five fields', () => {
  const html = render(message({
    meta: {
      round: 1,
      handoff: {
        topic: '状态提示',
        consensus: ['用一句话说明'],
        disagreements: ['是否公开'],
        constraints: ['不改接口'],
        todos: ['写测试'],
      },
    },
  }))
  assert.match(html, /第 1 轮结论/)
  assert.match(html, /crew-handoff-topic[^>]*>状态提示/)
  assert.match(html, /共识[\s\S]*用一句话说明/)
  assert.match(html, /未解决的分歧[\s\S]*是否公开/)
  assert.match(html, /is-warning/)
  assert.match(html, /约束[\s\S]*不改接口/)
  assert.match(html, /待办[\s\S]*写测试/)
  assert.match(html, /完整结论/)
})

test('empty fields stay visible with quiet hints', () => {
  const html = render(message({
    text: '',
    meta: { round: 1 },
  }), room({ goal: '' }))
  assert.match(html, /未给出主题/)
  assert.match(html, /没有记录共识/)
  assert.match(html, /没有未解决的分歧/)
  assert.match(html, /没有额外约束/)
  assert.match(html, /没有待办/)
})

test('an old conclusion without meta still parses into fields', () => {
  const html = render(message({
    text: '## 主题\n旧主题\n## 共识\n- 旧共识',
  }))
  assert.match(html, /旧主题/)
  assert.match(html, /旧共识/)
  assert.match(html, /完整结论/)
})

test('a timed-out host keeps the discussion open', () => {
  const html = render(message({
    text: '讨论记录：甲说先做，乙说再等等。',
    meta: { round: 1, fallback: true },
  }))
  assert.match(html, /主持人未能在限定时间内总结/)
  assert.match(html, /完整讨论/)
})

test('an accepted conclusion keeps the signoff', () => {
  const html = render(message({
    ts: 1710000000000,
    meta: {
      round: 1,
      handoff: { topic: '状态提示', consensus: [], disagreements: [], constraints: [], todos: [] },
    },
  }), room({ state: 'complete' }))
  assert.match(html, /Lodge 主持/)
})
