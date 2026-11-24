import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./data-reset.mjs', import.meta.url))

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-reset-'))
  const dataDir = join(root, 'data')
  const workspaces = join(root, 'workspaces')
  const worktrees = join(root, 'worktrees')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'memory'), { recursive: true })
  mkdirSync(join(workspaces, 'room'), { recursive: true })
  mkdirSync(join(worktrees, 'copy'), { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'crew.db'))
  db.exec('CREATE TABLE room (id TEXT PRIMARY KEY)')
  db.close()
  writeFileSync(join(dataDir, 'memory', 'note.md'), 'memory')
  writeFileSync(join(workspaces, 'room', 'file.txt'), 'work')
  writeFileSync(join(worktrees, 'copy', 'file.txt'), 'copy')
  return { root, dataDir, workspaces, worktrees }
}

const run = (args, { dataDir, workspaces, worktrees }) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8',
  env: {
    ...process.env,
    CREW_WORKSPACE_ROOT: workspaces,
    CREW_WORKTREE_ROOT: worktrees,
  },
})

test('a dry run lists what would go and changes nothing', () => {
  const fixtureRoot = fixture()
  try {
    const result = run(['--data-dir', fixtureRoot.dataDir, '--workspaces', '--dry-run'], fixtureRoot)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /would reset: .*data/)
    assert.match(result.stdout, /would remove: .*crew\.db/)
    assert.match(result.stdout, /would archive: .*workspaces/)
    assert.match(result.stdout, /dry run: 没有改动任何数据/)
    assert.equal(existsSync(join(fixtureRoot.dataDir, 'crew.db')), true)
    assert.equal(existsSync(join(fixtureRoot.dataDir, 'memory', 'note.md')), true)
    assert.equal(existsSync(join(fixtureRoot.workspaces, 'room', 'file.txt')), true)
    assert.equal(existsSync(join(fixtureRoot.worktrees, 'copy', 'file.txt')), true)
  } finally {
    rmSync(fixtureRoot.root, { recursive: true, force: true })
  }
})

test('a real reset archives workspaces before removing them', () => {
  const fixtureRoot = fixture()
  try {
    // 冒烟护栏：确认脚本真的只看临时根目录。
    assert.equal(resolve(fixtureRoot.workspaces).startsWith(resolve(fixtureRoot.root)), true)
    const result = run(['--data-dir', fixtureRoot.dataDir, '--workspaces'], fixtureRoot)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /workspaces archived: /)
    assert.match(result.stdout, /data reset: /)
    assert.equal(existsSync(join(fixtureRoot.dataDir, 'crew.db')), false)
    assert.equal(existsSync(join(fixtureRoot.dataDir, 'memory')), false)
    assert.equal(existsSync(fixtureRoot.workspaces), false)
    assert.equal(existsSync(fixtureRoot.worktrees), false)
    assert.equal(existsSync(join(fixtureRoot.dataDir, '.lock')), false)
  } finally {
    rmSync(fixtureRoot.root, { recursive: true, force: true })
  }
})
