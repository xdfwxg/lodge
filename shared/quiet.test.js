import assert from 'node:assert/strict'
import test from 'node:test'
import { NOTIFY_COOLDOWN_MS, shouldNotify } from './quiet.js'

test('progress and review states do not interrupt', () => {
  for (const kind of ['review', 'rework', 'auto-check', 'parallel', 'idle']) {
    assert.equal(shouldNotify({ attention: { kind } }), false, kind)
  }
})

test('needs-you states interrupt, but the same room waits out the cooldown', () => {
  assert.equal(shouldNotify({ attention: { kind: 'approval' }, now: 10_000 }), true)
  assert.equal(shouldNotify({
    attention: { kind: 'approval' },
    lastAt: 10_000,
    now: 10_000 + NOTIFY_COOLDOWN_MS - 1,
  }), false)
  assert.equal(shouldNotify({
    attention: { kind: 'approval' },
    lastAt: 10_000,
    now: 10_000 + NOTIFY_COOLDOWN_MS,
  }), true)
})
