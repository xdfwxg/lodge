import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StageChapter } from './stage-chapter.js'

test('an empty completed stage is a static row, not an empty disclosure', () => {
  const html = renderToStaticMarkup(h(StageChapter, {
    chapter: {
      kind: 'stage',
      index: 2,
      title: '检查与结论',
      state: 'passed',
      expanded: false,
      summary: '',
    },
  }))
  assert.doesNotMatch(html, /<details/)
  assert.match(html, /第 3 步 · 检查与结论/)
})

test('a passed stage states its outcome once', () => {
  const html = renderToStaticMarkup(h(StageChapter, {
    chapter: {
      kind: 'stage',
      index: 0,
      title: '目标对齐',
      state: 'passed',
      expanded: false,
      summary: '已定',
    },
  }))
  assert.match(html, /第 1 步 · 目标对齐/)
  assert.match(html, /已定/)
  assert.doesNotMatch(html, /已完成/)
})

test('the prelude is context, not a step', () => {
  const html = renderToStaticMarkup(h(StageChapter, {
    chapter: {
      kind: 'prelude',
      title: '开始前',
      state: null,
      expanded: false,
      summary: '',
    },
    children: [h('div', { className: 'crew-system' }, '房间还没开始')],
  }))
  assert.doesNotMatch(html, /<details/)
  assert.match(html, /开始前/)
  assert.match(html, /房间还没开始/)
})

test('the closing stage states the result and the check outcome', () => {
  const html = renderToStaticMarkup(h(StageChapter, {
    chapter: {
      kind: 'stage',
      index: 2,
      title: '检查与结论',
      state: 'passed',
      expanded: false,
      summary: '',
    },
    conclusion: {
      name: '自定义结果',
      commands: [{ exit: 0 }],
    },
  }))
  assert.match(html, /自定义结果/)
  assert.match(html, /1\/1 项检查通过/)
  assert.match(html, /结果见上方/)
})
