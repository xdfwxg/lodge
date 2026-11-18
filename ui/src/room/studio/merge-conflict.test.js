import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeConflictOf } from './merge-conflict.js'

test('a merge conflict exposes its stage, files and working directory', () => {
  const conflict = mergeConflictOf({
    repoPath: '/tmp/integration',
    mergeConflict: { stage: 1, worker: 'worker-2', files: ['shared.txt'], path: '/tmp/integration' },
  })
  assert.equal(conflict.stage, 1)
  assert.deepEqual(conflict.files, ['shared.txt'])
  assert.equal(conflict.path, '/tmp/integration')
})

test('a room without a conflict has no card', () => {
  assert.equal(mergeConflictOf({ repoPath: '/tmp/x' }), null)
})
