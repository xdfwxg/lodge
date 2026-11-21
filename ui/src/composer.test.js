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

test('a follow-up room renders one send control with a secondary menu', () => {
  const html = renderToStaticMarkup(h(Composer, { ...base, onStartRound: () => {} }))
  assert.match(html, /crew-send-split/)
  assert.match(html, /aria-label="更多提交方式"/)
  assert.match(html, /data-empty="true"/)
  assert.doesNotMatch(html, /crew-composer-followup/)
  assert.doesNotMatch(html, /role="menuitem"/)
})

test('a normal room keeps a single send button', () => {
  const html = renderToStaticMarkup(h(Composer, base))
  assert.match(html, /class="crew-send"/)
  assert.doesNotMatch(html, /crew-send-split/)
})

test('the stop control replaces the send control while a turn is running', () => {
  const stop = h('span', { className: 'fake-stop' }, 'stop')
  const html = renderToStaticMarkup(h(Composer, { ...base, onStartRound: () => {}, stopControl: stop }))
  assert.match(html, /fake-stop/)
  assert.doesNotMatch(html, /crew-send-split/)
})
