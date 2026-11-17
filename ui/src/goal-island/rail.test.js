import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IslandRail } from './rail.js'

const room = (id, over = {}) => ({
  id,
  name: id,
  leadMemberId: 'lead',
  state: 'active',
  goal: '把清单写完',
  stages: [
    { title: '写清单', kind: 'deliverable', state: 'active' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  messages: [],
  ...over,
})

test('the rail shows other live rooms and skips the current one', () => {
  const html = renderToStaticMarkup(h(IslandRail, {
    rooms: [room('当前房'), room('甲房'), room('乙房', { needsYou: { kind: 'review', label: '验收员在看' } })],
    currentId: '当前房',
    onSelect: () => {},
  }))
  assert.match(html, /甲房/)
  assert.match(html, /乙房/)
  assert.doesNotMatch(html, /当前房/)
  assert.match(html, /在等你/)
  assert.equal((html.match(/bt-rail-island/g) ?? []).length, 2)
})

test('the rail stays quiet when every other room is done', () => {
  const done = room('已完成', {
    stages: [
      { title: '写清单', kind: 'deliverable', state: 'passed' },
      { title: '验收与结论', kind: 'decision', state: 'passed' },
    ],
  })
  assert.equal(renderToStaticMarkup(h(IslandRail, { rooms: [room('当前房'), done], currentId: '当前房', onSelect: () => {} })), '')
})
