import assert from 'node:assert/strict'
import test from 'node:test'
import { verificationProofOf } from './verification-proof.js'

test('running a check counts as hands-on verification', () => {
  const proof = verificationProofOf([{ name: 'Bash', step: { target: 'npm test' } }])
  assert.equal(proof.ok, true)
  assert.equal(proof.kind, 'exec')
})

test('reading a changed file counts, reading an unrelated file does not', () => {
  const changedFiles = ['src/export.js', 'README.md']
  assert.equal(verificationProofOf([
    { name: 'Read', step: { target: 'src/export.js' } },
  ], { changedFiles }).ok, true)
  assert.equal(verificationProofOf([
    { name: 'Read', step: { target: '/tmp/worktree/README.md' } },
  ], { changedFiles }).ok, true)
  assert.equal(verificationProofOf([
    { name: 'Read', step: { target: 'node_modules/pkg/index.js' } },
  ], { changedFiles }).ok, false)
})

test('the verdict tool itself is not proof of verification', () => {
  assert.equal(verificationProofOf([
    { name: 'mcp__lodge_gate__submit_verdict', step: { target: 'covered' } },
  ], { changedFiles: ['src/export.js'] }).ok, false)
})

test('with no changed files, only running a check counts', () => {
  assert.equal(verificationProofOf([{ name: 'Read', step: { target: 'README.md' } }]).ok, false)
  assert.equal(verificationProofOf([{ name: 'Bash', step: { target: 'npm test' } }]).ok, true)
})
