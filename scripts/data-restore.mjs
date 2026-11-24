import { acquireDataLock } from '../server/crew/lock.js'
import {
  latestBackup, latestWorkspaceArchive, listBackups, listWorkspaceArchives,
  restoreBackup, restoreWorkspaceArchive,
} from '../server/crew/data-recovery.js'
import { workspaceRoot } from '../server/crew/paths.js'
import { scratchRoot } from '../server/crew/workspace-git.js'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const dataDir = resolve(option('--data-dir') ?? '.data')
const list = args.includes('--list')
const all = args.includes('--all')
const useLatest = args.includes('--latest') || all
const backup = option('--backup')
const workspace = option('--workspaces')
const useLatestWorkspaces = args.includes('--latest-workspaces') || all
const withWorkspaces = !args.includes('--no-workspaces')
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')

if (list) {
  const rows = listBackups(dataDir)
  if (rows.length === 0) console.log('没有数据库备份')
  for (const row of rows) console.log(`${row.name}\t${row.size} bytes`)
  const workspaces = listWorkspaceArchives(dataDir)
  if (workspaces.length === 0) console.log('没有工作区归档')
  for (const row of workspaces) console.log(`${row.name}\t${row.entries.map(item => item.kind).join(',')}`)
  process.exit(0)
}

const chosen = useLatest ? latestBackup(dataDir)?.file : backup
const chosenWorkspaces = withWorkspaces
  ? (workspace ?? (useLatestWorkspaces ? latestWorkspaceArchive(dataDir)?.name : undefined))
  : undefined
if ((chosen === undefined || chosen === null || chosen === '') &&
  (chosenWorkspaces === undefined || chosenWorkspaces === null || chosenWorkspaces === '')) {
  console.error('用法：npm run data:restore -- --list | --latest | --backup <file> | --all | --workspaces <name> [--data-dir <dir>] [--force] [--dry-run]')
  process.exit(2)
}

if (dryRun) {
  // 先把会恢复的东西说清楚，真正写盘留给不带 --dry-run 的那一次。
  if (chosen !== undefined && chosen !== null && chosen !== '') console.log(`would restore database: ${chosen}`)
  if (chosenWorkspaces !== undefined && chosenWorkspaces !== null && chosenWorkspaces !== '') {
    console.log(`would restore workspaces: ${chosenWorkspaces}`)
  }
  console.log('dry run: 没有改动任何数据')
  process.exit(0)
}

let release
try {
  release = acquireDataLock(dataDir)
  if (chosen !== undefined && chosen !== null && chosen !== '') {
    const result = restoreBackup({ dataDir, backup: chosen })
    console.log(`restored: ${result.restored}`)
    if (result.safety !== null) console.log(`previous database kept: ${result.safety}`)
  }
  if (chosenWorkspaces !== undefined && chosenWorkspaces !== null && chosenWorkspaces !== '') {
    const result = restoreWorkspaceArchive({
      dataDir,
      archive: chosenWorkspaces,
      roots: [
        { kind: 'workspaces', path: workspaceRoot() },
        { kind: 'worktrees', path: scratchRoot() },
      ],
      force,
    })
    console.log(`workspaces restored: ${result.restored}`)
    if (result.safety !== null) console.log(`previous workspaces kept: ${result.safety}`)
  }
} catch (error) {
  console.error(`restore failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  release?.()
}
