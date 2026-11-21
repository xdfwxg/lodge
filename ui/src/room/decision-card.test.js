import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DecisionCard, DecisionOption } from './decision-card.js'

test('a decision card renders one radio row per option with its cost', () => {
  const html = renderToStaticMarkup(h(DecisionCard, {
    kicker: '开工前决定',
    title: '先修哪一层？',
    lead: '选一个方向，再开始这一轮。',
  },
  h('div', { role: 'radiogroup', 'aria-label': '先修哪一层？' },
    h(DecisionOption, {
      title: '只加重试',
      detail: '快，但不解决根因',
      selected: false,
    }),
    h(DecisionOption, {
      title: '同时改服务端超时',
      detail: '慢，但更彻底',
      badge: '推荐',
      selected: true,
    }))))
  assert.match(html, /class="crew-decision"/)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /aria-checked="false"/)
  assert.match(html, /aria-checked="true"/)
  assert.match(html, /快，但不解决根因/)
  assert.match(html, /class="crew-decision-badge">推荐/)
})
