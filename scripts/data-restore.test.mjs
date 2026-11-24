import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./data-restore.mjs', import.meta.url))

const run = (dataDir, args) => spawnSync(process.execPath, [script, '--data-dir', dataDir, ...args], {
  encoding: 'utf8',
})

test('a restore dry run names the backup but writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-restore-'))
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'backups'), { recursive: true })
    const backup = join(dataDir, 'backups', 'crew-1-old.db')
    writeFileSync(backup, 'backup')
    const result = run(dataDir, ['--latest', '--no-workspaces', '--dry-run'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /would restore database: .*crew-1-old\.db/)
    assert.match(result.stdout, /dry run: 没有改动任何数据/)
    assert.equal(existsSync(join(dataDir, 'crew.db')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a restore without a target explains the usage instead of guessing', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-restore-empty-'))
  try {
    const dataDir = join(root, 'data')
    mkdirSync(dataDir, { recursive: true })
    const result = run(dataDir, ['--no-workspaces'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /用法：npm run data:restore/)
    assert.equal(existsSync(join(dataDir, 'crew.db')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
