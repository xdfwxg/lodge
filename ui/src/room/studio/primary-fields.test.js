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
