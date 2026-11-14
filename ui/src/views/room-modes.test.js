import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { roomUiKinds } from '../room/kinds.js'
import { uiModes } from './room-modes.js'

const REQUIRED = [
  'buildViewModel', 'buildDecision', 'header', 'activity',
  'decisionCard', 'transcript', 'presence', 'typing',
]

const sourceRoot = fileURLToPath(new URL('..', import.meta.url))

test('every UI room kind has a view implementing the same contract', () => {
  assert.deepEqual(Object.keys(uiModes).sort(), roomUiKinds.map(kind => kind.id).sort())
  for (const [id, mode] of Object.entries(uiModes)) {
    assert.equal(mode.id, id)
    for (const key of REQUIRED) {
      assert.equal(typeof mode[key], 'function', `${id} mode misses ${key}`)
    }
  }
})

test('shared presentation and the room shell never branch on room type', () => {
  const files = [
    'message-cards.js',
    'room/message-view.js',
    'room/timeline-model.js',
    'room/decision.js',
    'views/room-view.js',
  ]
  for (const file of files) {
    const text = readFileSync(`${sourceRoot}/${file}`, 'utf8')
    assert.doesNotMatch(text, /roomType/, `${file} reads roomType`)
    assert.doesNotMatch(text, /mode\.id\s*===/, `${file} branches on a mode id`)
  }
})
