import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatPrimaryFields } from './create.js'

const engine = overrides => ({
  id: 'pi',
  name: 'Pi',
  available: true,
  authenticated: true,
  capabilities: { approvalReview: false },
  ...overrides,
})

test('a ready chat hides the readiness row', () => {
  const html = renderToStaticMarkup(h(ChatPrimaryFields, {
    engines: [engine()],
    onRefresh: () => {},
  }))
  assert.equal(html, '')
})

test('a chat with no usable engine says why and offers refresh', () => {
  const html = renderToStaticMarkup(h(ChatPrimaryFields, {
    engines: [],
    onRefresh: () => {},
  }))
  assert.match(html, /还没有可用的模型服务/)
  assert.match(html, /刷新/)
})

test('a logged-out chat engine offers login and refresh on the main path', () => {
  const html = renderToStaticMarkup(h(ChatPrimaryFields, {
    engines: [engine({ authenticated: false, login: { args: ['auth', 'login'] } })],
    onLogin: () => {},
    onRefresh: () => {},
  }))
  assert.match(html, /登录 Pi/)
  assert.match(html, /刷新/)
})
