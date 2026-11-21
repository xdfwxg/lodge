import assert from 'node:assert/strict'
import test from 'node:test'
import { startupNoticeOf } from './startup.js'

test('a failed first start says what happened and offers a retry', () => {
  assert.deepEqual(startupNoticeOf({
    phase: 'ready',
    rooms: [],
    runtime: { ok: false, error: 'fetch failed' },
  }), {
    title: 'Lodge 还没准备好',
    body: 'Lodge 没连上，稍后再试一次。',
    tone: 'error',
    retry: true,
  })
})

test('a waiting first room stays quiet until it arrives', () => {
  assert.deepEqual(startupNoticeOf({ phase: 'ready', rooms: [], runtime: { ok: true } }), {
    title: 'Lodge 正在准备…',
    body: '第一间房马上就好。',
    tone: 'neutral',
    retry: true,
  })
  assert.deepEqual(startupNoticeOf({ phase: 'loading', rooms: [] }), {
    title: 'Lodge 正在准备…',
    body: null,
    tone: 'neutral',
    retry: false,
  })
})

test('a room already on screen needs no startup notice', () => {
  assert.equal(startupNoticeOf({ phase: 'ready', rooms: [{ id: 'room-1' }] }), null)
})
