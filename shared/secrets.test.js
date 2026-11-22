import assert from 'node:assert/strict'
import test from 'node:test'
import { redactSecrets } from './secrets.js'

test('tokens and env values are redacted', () => {
  const text = [
    'TOKEN=super-secret',
    'api_key: abcdef123456',
    'Authorization: Bearer abcdefghijklmnop',
    'sk-abcdefghijklmnopqrstuvwxyz',
    'PORT=3000',
  ].join('\n')
  const out = redactSecrets(text)
  assert.doesNotMatch(out, /super-secret|abcdef123456|abcdefghijklmnop|sk-abcdef/)
  assert.match(out, /TOKEN=\[redacted\]/)
  assert.match(out, /PORT=3000/)
})

test('sanitizeUntrusted removes secrets before they reach a prompt', async () => {
  const { sanitizeUntrusted } = await import('./untrusted-text.js')
  assert.equal(sanitizeUntrusted('password=hunter2'), 'password=[redacted]')
})
