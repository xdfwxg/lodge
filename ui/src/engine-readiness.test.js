import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EngineLogin } from './engine-login.js'
import { engineReadiness, engineReady } from './engine-readiness.js'

const engine = (id, overrides = {}) => ({
  id,
  name: id,
  available: true,
  authenticated: true,
  capabilities: { approvalReview: true },
  ...overrides,
})

test('no engines means the room cannot start', () => {
  assert.equal(engineReadiness([]).canStart, false)
  assert.equal(engineReadiness(undefined).canStart, false)
})

test('an executor-ready engine needs login and approval review', () => {
  const readiness = engineReadiness([
    engine('claude', { authenticated: false, login: { args: ['auth', 'login'] } }),
    engine('pi', { capabilities: { approvalReview: false } }),
  ], { requireApproval: true })
  assert.equal(readiness.canStart, false)
  assert.deepEqual(readiness.loginTargets.map(item => item.id), ['claude'])
  assert.deepEqual(readiness.noApproval.map(item => item.id), ['pi'])
  assert.equal(engineReady(readiness.installed[1], { requireApproval: true }), false)
})

test('a chat room can use a logged-in engine without approval review', () => {
  const readiness = engineReadiness([engine('pi', { capabilities: { approvalReview: false } })])
  assert.equal(readiness.canStart, true)
  assert.equal(engineReady(readiness.installed[0]), true)
})

test('the login row offers a terminal and a manual refresh', () => {
  const readiness = engineReadiness([
    engine('claude', { authenticated: false, login: { args: ['auth', 'login'] } }),
    engine('pi', { authenticated: false }),
  ], { requireApproval: true })
  const html = renderToStaticMarkup(h(EngineLogin, {
    readiness,
    onLogin: () => {},
    onRefresh: () => {},
  }))
  assert.match(html, /登录 claude/)
  assert.match(html, /刷新/)
  assert.match(html, /先在这台电脑上登录 pi/)
})
