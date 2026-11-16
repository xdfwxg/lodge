import { acquireDataLock } from '../server/crew/lock.js'
import { latestBackup, listBackups, restoreBackup } from '../server/crew/data-recovery.js'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const dataDir = resolve(option('--data-dir') ?? '.data')
const list = args.includes('--list')
const useLatest = args.includes('--latest')
const backup = option('--backup')

if (list) {
  const rows = listBackups(dataDir)
  if (rows.length === 0) console.log('没有备份')
  for (const row of rows) console.log(`${row.name}\t${row.size} bytes`)
  process.exit(0)
}

const chosen = useLatest ? latestBackup(dataDir)?.file : backup
if (chosen === undefined || chosen === null || chosen === '') {
  console.error('用法：npm run data:restore -- --list | --latest | --backup <file> [--data-dir <dir>]')
  process.exit(2)
}

let release
try {
  release = acquireDataLock(dataDir)
  const result = restoreBackup({ dataDir, backup: chosen })
  console.log(`restored: ${result.restored}`)
  if (result.safety !== null) console.log(`previous database kept: ${result.safety}`)
} catch (error) {
  console.error(`restore failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  release?.()
}
