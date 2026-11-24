import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PromiseDialog } from './promise-dialog.js'

const render = promise => renderToStaticMarkup(h(PromiseDialog, {
  promise,
  onSave: () => {},
  onClose: () => {},
}))

const promise = {
  text: '每周挑 5 个值得看的 GitHub 项目',
  schedule: { every: 'week', weekday: 5, at: '18:00' },
  delivery: { channel: 'room', to: '' },
}

test('the edit dialog starts from the current promise', () => {
  const html = render(promise)
  assert.match(html, /每周挑 5 个值得看的 GitHub 项目/)
  assert.match(html, /每周/)
  assert.match(html, /周五/)
  assert.match(html, /18:00/)
  assert.match(html, /留在房间/)
  assert.match(html, /保存/)
})

test('an email promise shows the address and frequency', () => {
  const html = render({ ...promise, delivery: { channel: 'email', to: 'me@example.com', mode: 'changes' } })
  assert.match(html, /me@example\.com/)
  assert.match(html, /发到邮箱/)
  assert.match(html, /有变化才发/)
})
