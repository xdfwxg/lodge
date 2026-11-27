import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EventLinkDialog, fullLinkOf } from './event-link-dialog.js'

const render = room => renderToStaticMarkup(h(EventLinkDialog, {
  room,
  onAction: async () => ({ ok: true, enabled: true, path: '/api/webhooks/r1/abc' }),
  onClose: () => {},
}))

test('a room without the link says how to open it', () => {
  const html = render({ id: 'r1' })
  assert.match(html, /还没开启/)
  assert.match(html, /开启/)
})

test('a room with the link fetches its address and offers copying', () => {
  const html = render({ id: 'r1', webhook: { enabled: true } })
  assert.match(html, /正在取地址/)
  assert.match(html, /复制地址/)
  assert.match(html, /换一个地址/)
  assert.match(html, /关掉/)
})

test('the address is shown against the app origin', () => {
  assert.equal(fullLinkOf('/api/webhooks/r1/abc'), '/api/webhooks/r1/abc')
  globalThis.location = { origin: 'http://127.0.0.1:8787' }
  assert.equal(fullLinkOf('/api/webhooks/r1/abc'), 'http://127.0.0.1:8787/api/webhooks/r1/abc')
  assert.equal(fullLinkOf(null), '')
  delete globalThis.location
})
