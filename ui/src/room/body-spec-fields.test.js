import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bodySpecOf, bodySpecPayload, CapabilityReadOnly } from './body-spec-fields.js'

test('a member body spec becomes editable text fields', () => {
  const spec = bodySpecOf({
    body: {
      spec: {
        prompt: '新纪律',
        skills: ['review', 'test'],
        mcp: [{ server: 'chrome-devtools' }, { server: 'github' }],
      },
    },
  })
  assert.equal(spec.prompt, '新纪律')
  assert.equal(spec.skillsText, 'review, test')
  assert.equal(spec.mcpText, 'github')
  assert.deepEqual(bodySpecOf({}), { prompt: '', skillsText: '', mcpText: '' })
})

test('text fields become a normalized payload', () => {
  assert.deepEqual(bodySpecPayload({
    prompt: '纪律',
    skillsText: 'review, test',
    mcpText: 'github',
  }), {
    prompt: '纪律',
    skills: ['review', 'test'],
    mcp: ['github'],
  })
  assert.deepEqual(bodySpecPayload({ prompt: '', skillsText: '', mcpText: '' }), {
    prompt: '',
    skills: [],
    mcp: [],
  })
})

test('role capabilities render as read-only lists, not inputs', () => {
  const html = renderToStaticMarkup(h(CapabilityReadOnly, {
    skills: ['lodge-build', 'lodge-diagnose'],
    mcp: [{ server: 'chrome-devtools' }, { server: 'github' }],
  }))
  assert.match(html, /lodge-build/)
  assert.match(html, /github/)
  assert.doesNotMatch(html, /<input/)
})

test('the built-in read-only browser is shown as a system capability', () => {
  const html = renderToStaticMarkup(h(CapabilityReadOnly, {
    skills: [],
    mcp: [{ server: 'chrome-devtools' }],
  }))
  assert.match(html, /只读浏览器（系统）/)
  assert.doesNotMatch(html, /chrome-devtools/)
  assert.doesNotMatch(html, /没有额外工具连接/)
  assert.doesNotMatch(html, /<input/)
})

test('the add-member form shows the browser that will be granted', () => {
  const html = renderToStaticMarkup(h(CapabilityReadOnly, {
    skills: ['lodge-build'],
    mcp: [],
    systemBrowser: true,
  }))
  assert.match(html, /只读浏览器（系统）/)
  assert.doesNotMatch(html, /没有额外工具连接/)
})

test('without any tool connection the empty state stays honest', () => {
  const html = renderToStaticMarkup(h(CapabilityReadOnly, { skills: [], mcp: [] }))
  assert.match(html, /没有额外工具连接/)
  assert.doesNotMatch(html, /只读浏览器/)
})
