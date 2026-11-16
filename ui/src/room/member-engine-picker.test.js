import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemberEnginePicker } from './member-engine-picker.js'

const render = approvalReview => renderToStaticMarkup(h(MemberEnginePicker, {
  members: [{ role: 'worker', name: '执行官' }],
  choices: [{ engine: 'pi', model: '' }],
  setChoices: () => {},
  engines: [{
    id: 'pi',
    name: 'Pi',
    available: true,
    models: { default: 'deepseek-flash', options: [{ id: 'deepseek-flash' }] },
    capabilities: { approvalReview },
  }],
}))

test('a model that cannot review permissions says external actions will run', () => {
  const html = render(false)
  assert.match(html, /不会先问你/)
  assert.match(html, /联网、安装、推送/)
})

test('a model with permission review shows no warning', () => {
  const html = render(true)
  assert.doesNotMatch(html, /不会先问你/)
})
