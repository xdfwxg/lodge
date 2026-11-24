import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PromiseCard } from './promise-card.js'

const room = over => ({
  id: 'room-1',
  goal: '每周挑 5 个值得看的 GitHub 项目',
  promise: {
    text: '每周挑 5 个值得看的 GitHub 项目',
    schedule: { every: 'week', weekday: 5, at: '18:00' },
    status: 'active',
    nextAt: Date.now() + 86_400_000,
    lastRunAt: null,
    lastRunStatus: null,
    runs: 0,
  },
  ...over,
})

const render = (roomValue, handlers = {}) => renderToStaticMarkup(h(PromiseCard, {
  room: roomValue,
  onRun: () => {},
  onPause: () => {},
  onResume: () => {},
  onStop: () => {},
  ...handlers,
}))

test('the promise card shows what was said and when it comes back', () => {
  const html = render(room())
  assert.match(html, /说好的/)
  assert.match(html, /每周挑 5 个值得看的 GitHub 项目/)
  assert.match(html, /每周五 18:00/)
  assert.match(html, /下次/)
  assert.match(html, /现在跑一次/)
  assert.match(html, /暂停/)
  assert.match(html, /不做了/)
})

test('a paused promise offers resume instead of run', () => {
  const html = render(room({ promise: { ...room().promise, status: 'paused' } }))
  assert.match(html, /恢复/)
  assert.doesNotMatch(html, /现在跑一次/)
  assert.match(html, /暂停了/)
})

test('a stopped promise can start again', () => {
  const html = render(room({ promise: { ...room().promise, status: 'stopped' } }))
  assert.match(html, /重新开始/)
  assert.doesNotMatch(html, /不做了/)
})

test('a delivered issue says whether it changed', () => {
  const html = render(room({
    promise: { ...room().promise, lastChange: 'no', lastRunAt: Date.now() },
  }))
  assert.match(html, /上次没变化/)
})

test('a room without a promise shows nothing', () => {
  assert.equal(render(room({ promise: null })), '')
})
