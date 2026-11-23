import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LINGCHONG_CSS, Lingchong, lingchongPose, lingchongSpot } from './lingchong.js'

test('chat keeps the companion at home until it needs you', () => {
  assert.equal(lingchongPose('rest', 'chat').phase, 'lie')
  assert.equal(lingchongPose('rest', 'chat').spot, 0.2)
  assert.equal(lingchongPose('needs', 'chat').spot, 0.5)
  assert.equal(lingchongPose('done', 'chat').phase, 'nap')
  assert.equal(lingchongPose('busy', 'chat').phase, 'walk')
})

test('studio walks the current step across the whole edge', () => {
  assert.equal(lingchongPose('rest', 'studio', 0).spot, 0.15)
  assert.equal(lingchongPose('rest', 'studio', 0.5).spot, 0.5)
  assert.equal(lingchongPose('busy', 'studio', 1).spot, 0.85)
  assert.equal(lingchongPose('done', 'studio', 1).spot, 0.85)
})

test('the lingchong stays inside the island edge', () => {
  assert.equal(lingchongSpot('rest', 400, 84, 'chat'), 80)
  assert.equal(lingchongSpot('needs', 400, 84, 'chat'), 200)
  assert.equal(lingchongSpot('done', 400, 84, 'studio'), 340)
  assert.equal(lingchongSpot('rest', 110, 84, 'studio', 0), 46)
  assert.equal(lingchongSpot('done', 110, 84, 'studio'), 64)
})

test('the face follows the island state, not just the body pose', () => {
  const needs = renderToStaticMarkup(h(Lingchong, { state: 'needs' }))
  assert.match(needs, /data-state="needs"/)
  assert.match(needs, /lingchong-face-alert/)
  assert.match(needs, /lingchong-question/)
  const busy = renderToStaticMarkup(h(Lingchong, { state: 'busy' }))
  assert.match(busy, /lingchong-face-focus/)
  assert.match(LINGCHONG_CSS, /\[data-state=needs\] \.lingchong-face-alert/)
  assert.match(LINGCHONG_CSS, /\[data-state=busy\] \.lingchong-face-focus/)
  assert.match(LINGCHONG_CSS, /prefers-reduced-motion[\s\S]*lingchong-question/)
})
