import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderSharedMessage } from './message-view.js'

const render = message => renderToStaticMarkup(renderSharedMessage({
  room: { id: 'room-1', humanName: '你', members: [] },
  byId: {},
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
