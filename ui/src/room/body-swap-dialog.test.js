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

test('a studio member only gets the model swap', () => {
  const html = render({ modelOnly: true })
  assert.match(html, /换个模型/)
  assert.match(html, /只换模型，记录和证据不变/)
  assert.match(html, /AI 服务/)
  assert.doesNotMatch(html, /性格/)
  assert.doesNotMatch(html, /移出房间/)
  assert.doesNotMatch(html, /模型与能力/)
})

test('a chat member still gets the full member card', () => {
  const html = render({ modelOnly: false })
  assert.match(html, /模型与能力/)
  assert.match(html, /性格/)
})
