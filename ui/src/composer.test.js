import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Composer } from './composer.js'

const base = {
  placeholder: '问规划师',
  disabled: false,
  onSend: () => {},
  onSent: () => {},
}

const withDraft = (text, run) => {
  const original = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => text,
    setItem: () => {},
    removeItem: () => {},
  }
  try {
    return run()
  } finally {
    globalThis.localStorage = original
  }
}

test('an empty composer keeps the row quiet: no send control at all', () => {
  const html = renderToStaticMarkup(h(Composer, base))
  assert.doesNotMatch(html, /aria-label="发送"/)
  assert.doesNotMatch(html, /crew-send/)
})

test('typed text shows exactly one return arrow', () => {
  const html = withDraft('修登录超时', () => renderToStaticMarkup(h(Composer, {
    ...base,
    draftKey: 'room-1',
  })))
  assert.match(html, /class="crew-send"/)
  assert.doesNotMatch(html, /更多提交方式/)
  assert.doesNotMatch(html, /crew-send-split/)
})

test('the stop control replaces the send control while a turn is running', () => {
  const stop = h('span', { className: 'fake-stop' }, 'stop')
  const html = withDraft('修登录超时', () => renderToStaticMarkup(h(Composer, {
    ...base,
    draftKey: 'room-3',
    stopControl: stop,
  })))
  assert.match(html, /fake-stop/)
  assert.doesNotMatch(html, /crew-send/)
})
