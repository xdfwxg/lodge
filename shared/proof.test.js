import assert from 'node:assert/strict'
import test from 'node:test'
import { PROOF_ENTRY_LIMIT, normalizeProof } from './proof.js'

test('a proof names one entry and optional clause steps', () => {
  const proof = normalizeProof({
    entry: 'npm test',
    steps: [
      { clause: 'export', run: 'npm test', expect: 'exit 0' },
      { clause: '', run: 'npm run lint' },
      { run: '' },
    ],
  })
  assert.equal(proof.entry, 'npm test')
  assert.equal(proof.steps.length, 2)
  assert.deepEqual(proof.steps[0], { clause: 'export', run: 'npm test', expect: 'exit 0' })
  assert.deepEqual(proof.steps[1], { run: 'npm run lint' })
})

test('a proof without an entry is not a proof', () => {
  assert.equal(normalizeProof({ steps: [{ run: 'npm test' }] }), null)
  assert.equal(normalizeProof(null), null)
  assert.equal(normalizeProof({ entry: '  ' }), null)
})

test('a long command is kept whole or refused, never cut into a broken one', () => {
  const long = `node -e '${'x'.repeat(900)}'`
  assert.equal(normalizeProof({ entry: long }).entry, long)
  const tooLong = `node -e '${'x'.repeat(PROOF_ENTRY_LIMIT)}'`
  assert.equal(normalizeProof({ entry: tooLong }), null)
  assert.deepEqual(normalizeProof({ entry: 'npm test', steps: [{ run: tooLong }] }).steps, [])
})
