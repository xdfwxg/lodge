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
  // 工作室成员由规划师组队，侧栏不再提供“添加成员”。
  assert.doesNotMatch(html, /添加成员/)
})

test('only chat members offer mute, not studio members', () => {
  const chat = renderToStaticMarkup(h(SideMembers, {
    room: room({ roomType: 'chat' }),
    onHold: () => {},
  }))
  assert.match(chat, /role="switch"/)
  assert.match(chat, /aria-label="规划师说话"/)
  // 默认是「能说话」：开关在右、绿色；静音后才回到灰。
  assert.match(chat, /aria-checked="true"/)
  const studio = renderToStaticMarkup(h(SideMembers, { room: room(), onHold: () => {} }))
  assert.doesNotMatch(studio, /role="switch"/)
  assert.doesNotMatch(studio, /停下这位成员/)
})

test('only members with something happening say it', () => {
  const html = renderToStaticMarkup(h(SideMembers, {
    room: room({ busyMembers: ['worker'], heldMembers: ['lead'] }),
  }))
  assert.match(html, /处理中/)
  assert.match(html, /不派活/)
})

test('a finished room keeps the crew but not the add row', () => {
  const html = renderToStaticMarkup(h(SideMembers, {
    room: room({ stages: [{ state: 'passed' }] }),
  }))
  assert.match(html, /规划师/)
  assert.doesNotMatch(html, /添加成员/)
})

test('every member picks a robot in place, and one done saves them together', () => {
  const engines = [
    { id: 'claude', name: 'Claude', available: true, authenticated: true, models: { default: 'sonnet' } },
    { id: 'pi', name: 'pi', available: true, authenticated: true, models: { default: 'deepseek-flash' } },
  ]
  const html = renderToStaticMarkup(h(SideMembers, { room: room(), engines, onSwapBody: () => {} }))
  assert.equal((html.match(/<select/g) ?? []).length, 3)
  assert.equal((html.match(/crew-side-member-edit-done/g) ?? []).length, 1)
  // 没有改动时，唯一的完成按钮是灰的。
  assert.match(html, /crew-side-member-edit-done[^>]*disabled/)
  assert.doesNotMatch(html, /crew-body-swap/)
})

test('a chat room names speaking and offers mute and a model swap, not add', () => {
  const html = renderToStaticMarkup(h(SideMembers, {
    room: room({ roomType: 'chat', busyMembers: ['worker'] }),
    onHold: () => {},
  }))
  assert.match(html, /发言中/)
  assert.doesNotMatch(html, /添加成员/)
  assert.match(html, /aria-label="执行官说话"/)
  assert.match(html, /aria-checked="true"/)
})
