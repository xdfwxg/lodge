import assert from 'node:assert/strict'
import test from 'node:test'
import { clampSide, readSidebarLayout, SIDE_MAX, SIDE_MIN } from './sidebar-layout.js'

test('sidebar width stays inside the usable range', () => {
  assert.equal(clampSide(SIDE_MIN - 20), SIDE_MIN)
  assert.equal(clampSide(SIDE_MAX + 20), SIDE_MAX)
  assert.equal(clampSide(320), 320)
})

test('sidebar layout reads a stored width and collapse flag', () => {
  const previous = globalThis.localStorage
  const values = new Map([['lodge:side-width', '320px'], ['lodge:side-collapsed', '1']])
  globalThis.localStorage = { getItem: key => values.get(key) ?? null }
  try {
    assert.deepEqual(readSidebarLayout(), { width: 320, collapsed: true })
  } finally {
    globalThis.localStorage = previous
  }
})
