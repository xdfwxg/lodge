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

test('a handoff line stays in the conversation column', () => {
  const html = render({
    id: 'm4',
    kind: 'system',
    text: '@验收员 请复核。',
    meta: { kind: 'handoff' },
  })
  assert.match(html, /data-chain="handoff"/)
  assert.match(html, /crew-system/)
})

test('a plain system notice keeps the centered treatment', () => {
  const html = render({ id: 'm5', kind: 'system', text: '第 2 步确认了。' })
  assert.doesNotMatch(html, /data-chain="handoff"/)
})

test('a model-written @you never leaks the internal user id', () => {
  const html = renderToStaticMarkup(renderSharedMessage({
    room: { id: 'room-1', humanName: '千寻', members: [] },
    byId: { w: { id: 'w', name: '乙', title: '' } },
    message: { id: 'm-you', kind: 'chat', authorId: 'w', text: '倒是甲那个版本问题我不太确定。@you 千寻，你看的是哪一版？' },
  }))
  assert.doesNotMatch(html, /@you/)
  assert.match(html, /千寻/)
  assert.doesNotMatch(html, /千寻 千寻/)
})

test('bold around Chinese punctuation renders instead of showing raw stars', () => {
  const html = renderToStaticMarkup(renderSharedMessage({
    room: { id: 'room-1', humanName: '千寻', members: [] },
    byId: { w: { id: 'w', name: '乙', title: '' } },
    message: { id: 'm-bold', kind: 'chat', authorId: 'w', text: '是**“没有说破”的克制最动人**——情绪没爆。' },
  }))
  assert.match(html, /<strong>/)
  assert.doesNotMatch(html, /\*\*/)
})
