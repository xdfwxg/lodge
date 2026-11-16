import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensureDirInside } from './workspace-paths.js'

test('runtime directories cannot be redirected outside the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-path-'))
  const outside = mkdtempSync(join(tmpdir(), 'lodge-outside-'))
  try {
    const inside = join(root, '.lodge')
    assert.equal(ensureDirInside(root, inside), inside)
    symlinkSync(outside, join(root, '.crew'))
    assert.throws(() => ensureDirInside(root, join(root, '.crew')), /不在工作区内/)
    assert.throws(() => ensureDirInside(root, join(root, '.crew', 'rooms')), /不在工作区内/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
