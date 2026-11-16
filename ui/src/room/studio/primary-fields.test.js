import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudioPrimaryFields, VerifyChoice } from './create.js'

const render = props => renderToStaticMarkup(h(StudioPrimaryFields, props))

test('the primary setup shows the default team and the verification choice', () => {
  const html = render({})
  assert.match(html, /规划师/)
  assert.match(html, /执行官/)
  assert.match(html, /验收员/)
  assert.match(html, /调整成员与模型/)
  assert.match(html, /我自己看/)
  assert.match(html, /跑一条检查/)
})

test('a handoff hides the duplicate verification choice but keeps the team', () => {
  const html = render({ showVerify: false })
  assert.match(html, /规划师/)
  assert.doesNotMatch(html, /我自己看/)
})

test('choosing a command reveals the check input', () => {
  const html = renderToStaticMarkup(h(VerifyChoice, { verifyMode: 'test', acceptanceDraft: 'npm test' }))
  assert.match(html, /要跑的检查/)
  assert.match(html, /npm test/)
})

const engine = (id, approvalReview) => ({
  id,
  engine: id,
  name: id,
  available: true,
  capabilities: { approvalReview },
})

test('a model that never asks blocks the studio before it starts', () => {
  const html = render({ engines: [engine('pi', false)] })
  assert.match(html, /工作室开不了工/)
  assert.match(html, /聊天室/)
})

test('one available vendor points at the same-vendor self check', () => {
  const html = render({ engines: [engine('claude', true)] })
  assert.match(html, /只有一家模型可用/)
  assert.match(html, /自查/)
})

test('logged-out services do not count as usable models', () => {
  const html = render({ engines: [{ ...engine('claude', true), authenticated: false }] })
  assert.match(html, /先在这台电脑上登录/)
  assert.match(html, /刷新/)
})

test('a logged-out model offers a login button in the primary fields', () => {
  const html = render({
    engines: [{ ...engine('claude', true), authenticated: false, name: 'Claude', login: { args: ['auth', 'login'] } }],
    onLogin: () => {},
  })
  assert.match(html, /登录 Claude/)
})

test('two vendors show no guidance', () => {
  const html = render({ engines: [engine('claude', true), engine('codex', true)] })
  assert.doesNotMatch(html, /只有一家模型可用/)
  assert.doesNotMatch(html, /开不了工/)
})
