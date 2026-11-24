import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { acquireDataLock } from '../server/crew/lock.js'
import { archiveWorkspaces, databaseFile, memoryDir, snapshotDatabase } from '../server/crew/data-recovery.js'
import { workspaceRoot } from '../server/crew/paths.js'
import { scratchRoot } from '../server/crew/workspace-git.js'

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const dataDir = resolve(option('--data-dir') ?? '.data')
const withWorkspaces = args.includes('--workspaces')
const withBackup = !args.includes('--no-backup')
const withArchive = !args.includes('--no-archive')
const dryRun = args.includes('--dry-run')

const remove = path => {
  if (!existsSync(path)) return false
  rmSync(path, { recursive: true, force: true })
  return true
}

let release
try {
  release = acquireDataLock(dataDir)
  const now = Date.now()
  if (dryRun) {
    // 破坏性脚本先给一份可核对的清单；--dry-run 不备份、不归档、不删除。
    console.log(`would reset: ${dataDir}`)
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${databaseFile(dataDir)}${suffix}`
      if (existsSync(file)) console.log(`would remove: ${file}`)
    }
    if (existsSync(memoryDir(dataDir))) console.log(`would remove: ${memoryDir(dataDir)}`)
    if (withWorkspaces && withArchive) {
      for (const root of [workspaceRoot(), scratchRoot()]) {
        if (existsSync(root)) console.log(`would archive: ${root}`)
      }
    }
    if (withWorkspaces) {
      for (const root of [workspaceRoot(), scratchRoot()]) {
        if (root === '/' || root === homedir()) continue
        if (existsSync(root)) console.log(`would remove workspaces: ${root}`)
      }
    }
    console.log('dry run: 没有改动任何数据')
    process.exit(0)
  }
  if (withBackup && existsSync(databaseFile(dataDir))) {
    const backup = snapshotDatabase({ dataDir, reason: 'pre-reset', keep: 10, now })
    if (backup !== null) console.log(`backup: ${backup}`)
  }
  // 先归档，再删；归档失败就中止，原工作区还在。
  if (withWorkspaces && withArchive) {
    const folder = archiveWorkspaces({
      dataDir,
      now,
      roots: [
        { kind: 'workspaces', path: workspaceRoot() },
        { kind: 'worktrees', path: scratchRoot() },
      ],
    })
    if (folder !== null) console.log(`workspaces archived: ${folder}`)
  }

  for (const suffix of ['', '-wal', '-shm']) remove(`${databaseFile(dataDir)}${suffix}`)
  remove(memoryDir(dataDir))
  console.log(`data reset: ${dataDir}`)

  if (withWorkspaces) {
    for (const root of [workspaceRoot(), scratchRoot()]) {
      if (root === '/' || root === homedir()) continue
      if (remove(root)) console.log(`workspaces reset: ${root}`)
    }
  }
} catch (error) {
  console.error(`reset failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  release?.()
}
