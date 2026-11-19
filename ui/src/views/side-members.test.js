import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SideMembers } from './side-members.js'

const members = [
  { id: 'lead', name: '规划师', role: 'lead', body: { engine: 'claude', model: 'sonnet' } },
  { id: 'worker', name: '执行官', role: 'worker', body: { engine: 'pi', model: 'deepseek-flash' } },
  { id: 'verifier', name: '验收员', role: 'verifier', body: { engine: 'claude', model: 'sonnet' } },
]

const room = overrides => ({
  roomType: 'studio',
  state: 'active',
  live: true,
  members,
  ...overrides,
})

test('idle members stay quiet under the room', () => {
  const html = renderToStaticMarkup(h(SideMembers, { room: room() }))
  assert.match(html, /aria-label="房间成员"/)
  assert.match(html, /crew-side-members-label">成员/)
  assert.match(html, /规划师/)
  assert.match(html, /执行官/)
  assert.match(html, /验收员/)
  assert.doesNotMatch(html, /待命/)
  assert.match(html, /添加成员/)
})

test('only members with something happening say it', () => {
  const html = renderToStaticMarkup(h(SideMembers, {
    room: room({ busyMembers: ['worker'], heldMembers: ['lead'] }),
  }))
  assert.match(html, /处理中/)
  assert.match(html, /已叫停/)
})

test('a finished room keeps the crew but not the add row', () => {
  const html = renderToStaticMarkup(h(SideMembers, {
    room: room({ stages: [{ state: 'passed' }] }),
  }))
  assert.match(html, /规划师/)
  assert.doesNotMatch(html, /添加成员/)
})

test('a chat room names speaking and offers no add row', () => {
  const html = renderToStaticMarkup(h(SideMembers, {
    room: room({ roomType: 'chat', busyMembers: ['worker'] }),
  }))
  assert.match(html, /发言中/)
  assert.doesNotMatch(html, /添加成员/)
})
