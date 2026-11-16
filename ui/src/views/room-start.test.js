import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomStart } from './room-start.js'

const state = engines => ({
  phase: 'ready',
  runtime: { ok: true },
  engines,
})

test('a blocked first run offers a login button instead of a dead end', () => {
  const html = renderToStaticMarkup(h(RoomStart, {
    state: state([
      { id: 'claude', name: 'Claude', available: true, authenticated: false, login: { args: ['auth', 'login'] }, capabilities: { approvalReview: true } },
      { id: 'pi', name: 'Pi', available: true, authenticated: true, capabilities: { approvalReview: false } },
    ]),
    onCreate: () => {},
    onQuickStart: () => {},
    onRefresh: () => {},
  }))
  assert.match(html, /还不能开工/)
  assert.match(html, /登录 Claude/)
  assert.match(html, /disabled/)
})

test('no installed model blocks the first room instead of failing later', () => {
  const html = renderToStaticMarkup(h(RoomStart, {
    state: state([]),
    onCreate: () => {},
    onQuickStart: () => {},
  }))
  assert.match(html, /还不能开工/)
  assert.match(html, /先装一个会先问你的模型/)
  assert.match(html, /disabled/)
})

test('a logged-out model without a login command still shows the way out', () => {
  const html = renderToStaticMarkup(h(RoomStart, {
    state: state([
      { id: 'claude', name: 'Claude', available: true, authenticated: false, capabilities: { approvalReview: true } },
    ]),
    onCreate: () => {},
    onQuickStart: () => {},
    onRefresh: () => {},
  }))
  assert.match(html, /Claude还没登录/)
  assert.match(html, /刷新/)
  assert.match(html, /先登录/)
})

test('a ready engine starts normally', () => {
  const html = renderToStaticMarkup(h(RoomStart, {
    state: state([
      { id: 'claude', name: 'Claude', available: true, authenticated: true, capabilities: { approvalReview: true } },
    ]),
    onCreate: () => {},
    onQuickStart: () => {},
    onRefresh: () => {},
  }))
  assert.doesNotMatch(html, /还不能开工/)
})
