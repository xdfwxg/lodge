import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { copyEntry, copyWorkspace } from './workspace-fs.js'

test('copies leave env variants and local runtime files behind', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-fs-'))
  try {
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(source)
    for (const name of ['.env', '.env.local', '.env.production', '.env.example']) {
      writeFileSync(join(source, name), 'X=1\n')
    }
    mkdirSync(join(source, '.lodge'))
    writeFileSync(join(source, '.lodge', 'env'), 'X=1\n')
    mkdirSync(join(source, '.crew'))
    writeFileSync(join(source, '.crew', 'GOAL.md'), 'goal\n')
    writeFileSync(join(source, 'README.md'), '# demo\n')
    copyWorkspace(source, target)
    assert.equal(existsSync(join(target, 'README.md')), true)
    assert.equal(existsSync(join(target, '.env.example')), true)
    for (const name of ['.env', '.env.local', '.env.production', '.lodge', '.crew']) {
      assert.equal(existsSync(join(target, name)), false, name)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('copyEntry never follows a symlink out of the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-fs-link-'))
  try {
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(source)
    mkdirSync(target)
    writeFileSync(join(root, 'secret.txt'), 'secret\n')
    symlinkSync(join(root, 'secret.txt'), join(source, 'link.txt'))
    assert.equal(copyEntry(source, target, 'link.txt'), false)
    assert.equal(existsSync(join(target, 'link.txt')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
