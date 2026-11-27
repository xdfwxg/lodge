import assert from 'node:assert/strict'
import test from 'node:test'
import { PROOF_ENTRY_LIMIT, normalizeProof } from './proof.js'

test('a proof is one entry plus optional extra commands', () => {
  // 只有命令，没有 clause：要求覆盖由验收员的复核负责，这份文件不对账。
  const proof = normalizeProof({
    entry: 'npm test',
    steps: ['npm run lint', { run: 'npm run typecheck' }, { run: '' }, 42],
  })
  assert.equal(proof.entry, 'npm test')
  assert.deepEqual(proof.steps, ['npm run lint', 'npm run typecheck'])
  // 旧写法（带 clause 的对象）也只取命令本身。
  assert.deepEqual(
    normalizeProof({ entry: 'npm test', steps: [{ clause: 'c1', run: 'npm test' }] }).steps,
    ['npm test'],
  )
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
