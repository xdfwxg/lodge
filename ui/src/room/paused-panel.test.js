import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PausedPanel } from './paused-panel.js'

const room = (over = {}) => ({
  id: 'room-1',
  state: 'paused',
  pauseReason: 'member_error',
  memberError: { memberId: 'worker', kind: 'auth' },
  ...over,
})

test('a stopped room puts the member fix before resume', () => {
  const html = renderToStaticMarkup(h(PausedPanel, {
    room: room(),
    onResume: () => {},
    onFixMember: () => {},
  }))
  assert.match(html, /重新登录/)
  assert.match(html, /继续/)
  const actions = html.slice(html.indexOf('crew-state-actions'))
  assert.ok(actions.indexOf('重新登录') < actions.indexOf('继续'))
})

test('a plain pause still offers resume', () => {
  const html = renderToStaticMarkup(h(PausedPanel, {
    room: room({ pauseReason: 'mcp', memberError: undefined }),
    onResume: () => {},
    onFixMember: () => {},
  }))
  assert.match(html, /连接中断/)
  assert.match(html, /继续/)
})
