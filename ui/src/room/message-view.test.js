import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderSharedMessage } from './message-view.js'

const render = (message, byId = {}) => renderToStaticMarkup(renderSharedMessage({
  room: { id: 'room-1', humanName: '你', members: [] },
  byId,
  message,
}))

test('a direct chat message says who it asked', () => {
  const html = render({
    id: 'm1',
    kind: 'chat',
    authorId: 'you',
    text: '@甲 看这里',
    meta: { direct: ['甲'] },
  })
  assert.match(html, /直接问 甲/)
})

test('a chat member with a stance shows the two-character label', () => {
  const byId = { a: { id: 'a', name: '甲', stance: 'critic', title: '' } }
  const html = render({ id: 'm2', kind: 'chat', authorId: 'a', text: '这里有个漏洞。' }, byId)
  assert.match(html, /crew-speaker-stance/)
  assert.match(html, />质疑</)
})

test('a member without a stance shows no label', () => {
  const byId = { b: { id: 'b', name: '乙', title: '' } }
  const html = render({ id: 'm3', kind: 'chat', authorId: 'b', text: '我同意。' }, byId)
  assert.doesNotMatch(html, /crew-speaker-stance/)
})
