import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemberEnginePicker } from './member-engine-picker.js'

const render = ({ approvalReview, authenticated, requireApprovalGate = true, permissions = { exec: true } } = {}) => (
  renderToStaticMarkup(h(MemberEnginePicker, {
    members: [{ role: 'worker', name: '执行官', permissions }],
    choices: [{ engine: 'pi', model: '' }],
    setChoices: () => {},
    requireApprovalGate,
    engines: [{
      id: 'pi',
      name: 'Pi',
      available: true,
      engine: 'pi',
      models: { default: 'deepseek-flash', options: [{ id: 'deepseek-flash' }] },
      ...(authenticated === undefined ? {} : { authenticated }),
      capabilities: { approvalReview },
    }],
  }))
)

test('an exec member cannot pick a model that never asks', () => {
  const html = render({ approvalReview: false })
  assert.match(html, /不能执行/)
  assert.match(html, /不能用来执行/)
  assert.ok(html.includes('disabled'), 'the option should be disabled')
})

test('a model with permission review stays selectable', () => {
  const html = render({ approvalReview: true })
  assert.doesNotMatch(html, /不能用来执行/)
  assert.doesNotMatch(html, /不能执行/)
})

test('a logged-out service is not selectable and says why', () => {
  const html = render({ approvalReview: true, authenticated: false })
  assert.match(html, /未登录/)
  assert.ok(html.includes('disabled'))
  assert.match(html, /没有登录/)
})

test('rooms without exec work still allow the same model', () => {
  const html = render({ approvalReview: false, requireApprovalGate: false })
  assert.doesNotMatch(html, /不能用来执行/)
})
