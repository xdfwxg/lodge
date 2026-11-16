import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from './store.js'
import {
  databaseFile, latestBackup, listBackups, restoreBackup, snapshotDatabase, verifyDatabase,
} from './data-recovery.js'

test('a database snapshot verifies and can restore the previous room state', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-backup-'))
  const repo = mkdtempSync(join(tmpdir(), 'lodge-backup-repo-'))
  let store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'room-1', kind: 'room', name: '备份验证', goal: 'g', state: 'active', repoPath: repo, stages: [], members: [] })
    store.appendMessage('room-1', { kind: 'system', text: '恢复我' })
    store.db.close()

    const backup = snapshotDatabase({ dataDir, reason: 'test' })
    assert.equal(typeof backup, 'string')
    assert.equal(verifyDatabase(backup), null)
    assert.equal(listBackups(dataDir)[0].file, backup)
    assert.equal(latestBackup(dataDir).file, backup)

    store = createStore({ dataDir })
    store.db.prepare('DELETE FROM messages').run()
    store.db.close()

    const result = restoreBackup({ dataDir, backup })
    assert.equal(result.restored, backup)
    assert.equal(typeof result.safety, 'string')
    store = createStore({ dataDir })
    assert.equal(store.readMessages('room-1')[0].text, '恢复我')
  } finally {
    try { store.db.close() } catch {}
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a non-database file is rejected before restore', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-bad-backup-'))
  try {
    const file = join(dataDir, 'not-a-db.db')
    writeFileSync(file, 'not sqlite')
    assert.match(verifyDatabase(file), /无法打开|完整性/)
    assert.throws(() => restoreBackup({ dataDir, backup: file }), /备份不可用/)
    assert.equal(existsSync(databaseFile(dataDir)), false)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
