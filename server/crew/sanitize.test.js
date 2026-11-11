import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeHandoff, sanitizeText } from './sanitize.js'

test('public samples drop keys, tokens, emails and local paths', () => {
  const text = [
    'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'contact alice@example.com',
    'path /Users/alice/project/secret.txt',
    'win C:\\Users\\bob\\work\\notes.md',
    'tmp /var/folders/ab/cdef/T/lodge-accept-123/repo',
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n')
  const result = sanitizeText(text)
  assert.doesNotMatch(result.text, /sk-abcdefghijklmnopqrstuvwxyz/)
  assert.doesNotMatch(result.text, /Bearer abcdefghijklmnopqrstuvwxyz/)
  assert.doesNotMatch(result.text, /alice@example\.com/)
  assert.doesNotMatch(result.text, /\/Users\/alice/)
  assert.doesNotMatch(result.text, /C:\\Users\\bob/)
  assert.doesNotMatch(result.text, /\/var\/folders\/ab/)
  assert.doesNotMatch(result.text, /BEGIN RSA PRIVATE KEY/)
  assert.match(result.text, /\[邮箱已移除\]/)
  assert.match(result.text, /\[本机路径已移除\]/)
  assert.equal(result.count >= 7, true)
})

test('sanitizing a handoff keeps its structure importable', () => {
  const bundle = {
    format: 'lodge.room-handoff.v1',
    version: 1,
    room: { id: 'room-x', name: '样本', goal: '联系人 alice@example.com' },
    files: {
      'transcript.jsonl': `${JSON.stringify({ id: 'm1', kind: 'system', text: 'access_token=abcdefghijklmnop' })}\n`,
    },
  }
  const clean = sanitizeHandoff(bundle)
  assert.equal(clean.format, bundle.format)
  assert.equal(clean.version, 1)
  assert.equal(clean.sanitized, true)
  assert.match(clean.room.goal, /\[邮箱已移除\]/)
  assert.doesNotMatch(clean.files['transcript.jsonl'], /abcdefghijklmnop/)
  assert.equal(clean.redactionCount >= 2, true)
})
