import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { collectWorkspaceGarbage } from './workspace-gc.js'

test('old orphan worktree dirs are removed; known rooms are kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'crew-gc-'))
  const orphan = join(root, 'orphan')
  const known = join(root, 'known')
  mkdirSync(orphan)
  mkdirSync(known)
  writeFileSync(join(orphan, 'x'), 'x')
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  utimesSync(orphan, old, old)
  const store = {
    readRooms: () => [],
    readRoom: id => (id === 'room-known' ? { id } : null),
    updateRoom: () => null,
  }
  try {
    const ports = createCrewPorts()
    const result = collectWorkspaceGarbage({ store, workspace: ports.workspace, files: ports.files, rootPath: root, ttlMs: 7 * 24 * 60 * 60 * 1000, removeOrphans: true })
    assert.equal(result.orphans, 1)
    assert.equal(existsSync(orphan), false)
    assert.equal(existsSync(known), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
