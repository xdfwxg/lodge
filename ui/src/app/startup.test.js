import assert from 'node:assert/strict'
import test from 'node:test'
import { startupNoticeOf } from './startup.js'

test('a failed first start names the model service, not Lodge, and offers a retry', () => {
  assert.deepEqual(startupNoticeOf({
    phase: 'ready',
    rooms: [],
    runtime: { ok: false, error: 'fetch failed' },
  }), {
    title: 'Lodge 还没准备好',
    body: '模型服务没连上，稍后自动重试。',
    tone: 'error',
    retry: true,
  })
})

test('a Chinese reason from the model service is shown as it is', () => {
  assert.equal(startupNoticeOf({
    phase: 'ready',
    rooms: [],
    runtime: { ok: false, error: '模型服务正在重启' },
  }).body, '模型服务正在重启')
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
