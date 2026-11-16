import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { collectWorkspaceGarbage } from './workspace-gc.js'

test('rewind branches are pruned for active rooms too', () => {
  const calls = []
  const workspace = {
    default: { scratchRoot: () => '/nonexistent' },
    provider: () => ({
      pruneMembers: () => [],
      pruneRewindBranches: args => {
        calls.push(args)
        return 2
      },
    }),
  }
  const store = {
    readRooms: () => [{ id: 'room-1', state: 'active', sourceRepo: '/repo', workspace: { provider: 'git' } }],
    readRoom: () => null,
    updateRoom: () => null,
  }
  const result = collectWorkspaceGarbage({
    store,
    workspace,
    files: { exists: () => false },
    ttlMs: 1_000,
    rewindTtlMs: 5_000,
    now: 100_000,
  })
  assert.equal(result.rewound, 2)
  assert.equal(result.pruned, 0)
  assert.deepEqual(calls, [{ path: '/repo', ttlMs: 5_000, now: 100_000 }])
})

test('a room with an unknown provider is skipped instead of failing GC', () => {
  const workspace = {
    default: { scratchRoot: () => '/nonexistent' },
    provider: () => {
      throw new Error('未知的工作区 provider：demo')
    },
  }
  const store = {
    readRooms: () => [{ id: 'room-sample', state: 'complete', workspace: { provider: 'demo' } }],
    readRoom: () => null,
    updateRoom: () => null,
  }
  const result = collectWorkspaceGarbage({ store, workspace, files: { exists: () => false } })
  assert.equal(result.pruned, 0)
})

test('orphan cleanup scans the plain copy root too and skips direct snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'crew-gc-plain-'))
  const orphan = join(root, 'plain-orphan')
  const direct = join(root, 'direct-abc')
  mkdirSync(orphan)
  mkdirSync(direct)
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  utimesSync(orphan, old, old)
  utimesSync(direct, old, old)
  const store = { readRooms: () => [], readRoom: () => null, updateRoom: () => null }
  try {
    const ports = createCrewPorts()
    const workspace = {
      ...ports.workspace,
      default: { scratchRoot: () => join(root, 'does-not-exist') },
      byId: id => id === 'plain' ? { scratchRoot: () => root } : ports.workspace.byId(id),
    }
    const result = collectWorkspaceGarbage({
      store,
      workspace,
      files: ports.files,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      removeOrphans: true,
    })
    assert.equal(result.orphans, 1)
    assert.equal(existsSync(orphan), false)
    assert.equal(existsSync(direct), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
