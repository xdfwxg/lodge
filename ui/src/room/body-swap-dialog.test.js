import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BodySwapDialog } from './body-swap-dialog.js'

// The dialog is client-only; give the render pass the few globals useOverlay reads.
globalThis.HTMLElement ??= class {}
globalThis.Node ??= class {}
globalThis.document ??= { activeElement: null, body: null }

const member = {
  id: 'worker-1',
  name: '阿青',
  role: 'worker',
  roleKind: 'executor',
  body: { engine: 'claude', model: 'x' },
  permissions: { read: true, exec: true, write: true },
}

const render = over => renderToStaticMarkup(h(BodySwapDialog, {
  member,
  engines: [],
  onCancel: () => {},
  onConfirm: () => {},
  onRefresh: () => {},
  ...over,
}))

test('every member only gets the robot picker', () => {
  const html = render()
  assert.match(html, /<b>阿青<\/b>/)
  assert.doesNotMatch(html, /换个/)
  assert.doesNotMatch(html, /换好/)
  assert.match(html, /完成/)
  assert.match(html, /disabled/)
  assert.doesNotMatch(html, /性格/)
  assert.doesNotMatch(html, /移出房间/)
  assert.doesNotMatch(html, /模型与能力/)
})

test('a chat member can still be removed from the same dialog', () => {
  const html = render({ canRemove: true, onRemove: () => {} })
  assert.match(html, /移出房间/)
  assert.doesNotMatch(html, /性格/)
  assert.doesNotMatch(html, /模型与能力/)
})

test('a chat participant gets the same robot picker', () => {
  const html = render({ member: { ...member, role: 'worker', roleKind: 'participant', name: '小林' } })
  assert.match(html, /<b>小林<\/b>/)
  assert.doesNotMatch(html, /执行者|规划师|验收员/)
})
