import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { gateCardState, HandoffBriefReview } from './handoff-brief-review.js'

test('a clean handoff brief with manual review can start', () => {
  assert.deepEqual(gateCardState({ needsReview: false, reviewed: false }), {
    ready: true,
    status: '可以开工',
    pendingText: null,
  })
})

test('open disagreements keep the card pending until reviewed', () => {
  assert.equal(gateCardState({ needsReview: true, reviewed: false }).status, '有分歧')
  assert.equal(gateCardState({ needsReview: true, reviewed: false }).pendingText, '先确认这些分歧，再开工。')
  assert.equal(gateCardState({ needsReview: true, reviewed: true }).status, '可以开工')
})

test('unknowns stay visible in the full brief', () => {
  const html = renderToStaticMarkup(h(HandoffBriefReview, {
    handoffBrief: {
      topic: '发布检查',
      consensus: ['先做最小版本'],
      disagreements: [],
      unknowns: ['回滚还没验证'],
      constraints: [],
      todos: [],
    },
    reviewed: false,
    onReviewed: () => {},
  }))
  assert.match(html, /未定 1/)
  assert.match(html, /未定/)
  assert.match(html, /回滚还没验证/)
})
