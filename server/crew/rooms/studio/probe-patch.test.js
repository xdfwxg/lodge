import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyProbePatch } from './probe-patch.js'

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-probe-patch-'))
  const dir = join(root, 'patches')
  const workspace = join(root, 'workspace')
  mkdirSync(dir, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  return { root, dir, workspace }
}

test('a probe patch replaces the review copy only for its stage', () => {
  const { root, dir, workspace } = setup()
  try {
    writeFileSync(join(dir, 'room-1.json'), JSON.stringify({
      stage: 1,
      files: { 'README.md': '# defective\n' },
    }))
    assert.deepEqual(applyProbePatch({ dir, roomId: 'room-1', root: workspace, stageIndex: 1 }), ['README.md'])
    assert.equal(readFileSync(join(workspace, 'README.md'), 'utf8'), '# defective\n')
    assert.deepEqual(applyProbePatch({ dir, roomId: 'room-1', root: workspace, stageIndex: 0 }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a probe patch cannot escape the review copy', () => {
  const { root, dir, workspace } = setup()
  try {
    writeFileSync(join(dir, 'room-1.json'), JSON.stringify({
      stage: 1,
      files: { '../outside.txt': 'nope' },
    }))
    assert.deepEqual(applyProbePatch({ dir, roomId: 'room-1', root: workspace, stageIndex: 1 }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no patch directory means no work', () => {
  assert.deepEqual(applyProbePatch({ dir: '', roomId: 'room-1', root: '/tmp', stageIndex: 1 }), [])
})
