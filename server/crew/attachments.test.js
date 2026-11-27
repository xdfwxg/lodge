import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAttachments, textOfFile } from './attachments.js'

const base = {
  kind: 'image',
  name: '0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png',
  path: '/Users/me/Library/Application Support/Lodge/base-data-rs/attachments/0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png',
  mime: 'image/png',
  bytes: 1200,
}

test('a normal image attachment passes through', () => {
  const result = normalizeAttachments([base])
  assert.equal(result.error, undefined)
  assert.equal(result.attachments.length, 1)
  assert.equal(result.attachments[0].kind, 'image')
})

test('a path that does not end in the attachment name is refused', () => {
  const result = normalizeAttachments([{ ...base, path: '/tmp/other.png' }])
  assert.equal(result.error, '附件路径不合法')
})

test('more than ten attachments are refused', () => {
  const result = normalizeAttachments(Array.from({ length: 11 }, () => base))
  assert.match(result.error, /最多带 10 个/)
})

test('attachments over the total size budget are refused', () => {
  const heavy = { ...base, bytes: 9 * 1024 * 1024 }
  const result = normalizeAttachments(Array.from({ length: 5 }, () => heavy))
  assert.equal(result.error, '附件总量最多 40MB')
})

test('binary files do not become prompt text', () => {
  assert.equal(textOfFile(Buffer.from([0, 1, 2, 3])), '')
  assert.equal(textOfFile(Buffer.from('你好\n第二行')), '你好\n第二行')
})
