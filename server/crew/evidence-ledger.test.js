import assert from 'node:assert/strict'
import test from 'node:test'
import { evidenceDigest, verifyEvidenceIntegrity } from './evidence-ledger.js'

const entry = {
  id: 'e1',
  roomId: 'r1',
  seq: 3,
  kind: 'evidence',
  authorId: 'system',
  text: '验收命令已执行，退出码 0。',
  at: 1_700_000_000_000,
  meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0 },
}

test('an untouched ledger entry matches its stored digest', () => {
  const signed = { ...entry, digest: evidenceDigest(entry) }
  const integrity = verifyEvidenceIntegrity([signed])
  assert.deepEqual(integrity, { total: 1, verified: 1, ok: true, broken: [] })
})

test('a tampered payload is reported with stored and computed digests', () => {
  const signed = { ...entry, digest: evidenceDigest(entry) }
  const tampered = { ...signed, meta: { ...signed.meta, exit: 1 } }
  const integrity = verifyEvidenceIntegrity([tampered])
  assert.equal(integrity.ok, false)
  assert.equal(integrity.total, 1)
  assert.equal(integrity.verified, 0)
  assert.equal(integrity.broken.length, 1)
  assert.equal(integrity.broken[0].id, 'e1')
  assert.equal(integrity.broken[0].seq, 3)
  assert.equal(integrity.broken[0].storedDigest, signed.digest)
  assert.equal(integrity.broken[0].computedDigest, evidenceDigest({ ...entry, meta: { ...entry.meta, exit: 1 } }))
  assert.notEqual(integrity.broken[0].storedDigest, integrity.broken[0].computedDigest)
})

test('a missing digest is broken rather than silently accepted', () => {
  const integrity = verifyEvidenceIntegrity([entry])
  assert.equal(integrity.ok, false)
  assert.equal(integrity.broken[0].storedDigest, '')
})

test('an empty ledger verifies as empty and does not invent rows', () => {
  assert.deepEqual(verifyEvidenceIntegrity([]), { total: 0, verified: 0, ok: true, broken: [] })
})
