import assert from 'node:assert/strict'
import test from 'node:test'
import { lingchongPose, lingchongSpot } from './lingchong.js'

test('chat keeps the companion at home until it needs you', () => {
  assert.equal(lingchongPose('rest', 'chat').phase, 'lie')
  assert.equal(lingchongPose('rest', 'chat').spot, 0.3)
  assert.equal(lingchongPose('needs', 'chat').spot, 0.5)
  assert.equal(lingchongPose('done', 'chat').phase, 'nap')
  assert.equal(lingchongPose('busy', 'chat').phase, 'walk')
})

test('studio walks the current step, then settles at the right when done', () => {
  assert.equal(lingchongPose('rest', 'studio', 0).spot, 0.3)
  assert.equal(lingchongPose('rest', 'studio', 0.5).spot, 0.5)
  assert.equal(lingchongPose('busy', 'studio', 1).spot, 0.7)
  assert.equal(lingchongPose('done', 'studio', 1).spot, 0.72)
})

test('the lingchong stays inside the island edge', () => {
  assert.equal(lingchongSpot('rest', 400, 84, 'chat'), 120)
  assert.equal(lingchongSpot('needs', 400, 84, 'chat'), 200)
  assert.equal(lingchongSpot('done', 400, 84, 'studio'), 288)
  assert.equal(lingchongSpot('rest', 110, 84, 'studio', 0), 46)
  assert.equal(lingchongSpot('done', 110, 84, 'studio'), 64)
})
