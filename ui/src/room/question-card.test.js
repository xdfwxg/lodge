import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionCard } from './question-card.js'
import { renderSharedMessage } from './message-view.js'

test('a question card renders options and a free-text answer', () => {
  const html = renderToStaticMarkup(h(QuestionCard, {
    message: {
      id: 'q1',
      ts: 1,
      authorId: 'worker',
      text: '选哪个方案？',
      meta: { card: { requestId: 'ask-1', options: ['A', 'B'] } },
    },
    seat: { id: 'worker', name: '执行官' },
    onAnswer: () => {},
  }))
  assert.match(html, /选哪个方案/)
  assert.match(html, />A</)
  assert.match(html, />B</)
  assert.match(html, /写下回答/)
  assert.match(html, /回答/)
})

test('a queued human message offers cancel and steer', () => {
  const room = { seatSpecs: [] }
  const message = {
    id: 'm1',
    ts: 1,
    kind: 'chat',
    authorId: 'you',
    text: '还没轮到我',
    meta: { queueId: 'q1' },
  }
  const html = renderToStaticMarkup(h('div', null,
    renderSharedMessage({
      room,
      byId: {},
      message,
      onCancelQueue: () => {},
      onSteerQueue: () => {},
    })))
  assert.match(html, /排队中/)
  assert.match(html, /撤回/)
  assert.match(html, /插话/)
})
