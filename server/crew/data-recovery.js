import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const databaseFile = dataDir => join(dataDir, 'crew.db')
export const backupsDir = dataDir => join(dataDir, 'backups')

const check = file => {
  let db = null
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const value = db.prepare('PRAGMA integrity_check').get()?.integrity_check
    return value === 'ok' ? null : `完整性检查失败：${value ?? '未知'}`
  } catch (error) {
    return `无法打开：${error?.message ?? error}`
  } finally {
    try { db?.close() } catch {}
  }
}

export const verifyDatabase = file => {
  if (typeof file !== 'string' || file === '' || !existsSync(file)) return '文件不存在'
  return check(file)
}

export const listBackups = dataDir => {
  const dir = backupsDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.startsWith('crew-') && name.endsWith('.db'))
    .map(name => {
      const file = join(dir, name)
      const info = statSync(file)
      return { name, file, size: info.size, mtimeMs: info.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
}

export const latestBackup = dataDir => listBackups(dataDir)[0] ?? null

export const pruneBackups = (dataDir, keep = 10) => {
  const size = Math.max(1, Number(keep) || 10)
  const old = listBackups(dataDir).slice(size)
  for (const item of old) {
    try { rmSync(item.file, { force: true }) } catch {}
  }
  return old.length
}

// 服务器未打开数据库时使用；CLI 恢复和启动前快照都走这里。
export const snapshotDatabase = ({ dataDir, reason = 'manual', keep = 10, now = Date.now() }) => {
  const source = databaseFile(dataDir)
  if (!existsSync(source)) return null
  const dir = backupsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const safeReason = String(reason).replace(/[^\w-]/g, '-').slice(0, 24) || 'manual'
  const target = join(dir, `crew-${now}-${safeReason}.db`)
  if (existsSync(target)) return target
  let db = null
  try {
    db = new DatabaseSync(source)
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    try { db?.close() } catch {}
  }
  pruneBackups(dataDir, keep)
  return target
}

export const resolveBackup = (dataDir, value) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const raw = value.trim()
  if (raw.includes('/') || raw.includes(sep)) return resolve(raw)
  return join(backupsDir(dataDir), raw)
}

// 只在 Lodge 未运行时调用；先给现状留一份快照，再替换数据库和 WAL。
export const restoreBackup = ({ dataDir, backup }) => {
  const source = resolveBackup(dataDir, backup)
  if (source === null) throw new Error('缺少要恢复的备份')
  if (!existsSync(source)) throw new Error(`备份不存在：${source}`)
  const problem = verifyDatabase(source)
  if (problem !== null) throw new Error(`备份不可用：${problem}`)

  const safety = (() => {
    try { return snapshotDatabase({ dataDir, reason: 'pre-restore', keep: 20 }) } catch { return null }
  })()
  const target = databaseFile(dataDir)
  for (const suffix of ['-wal', '-shm']) {
    try { rmSync(`${target}${suffix}`, { force: true }) } catch {}
  }
  copyFileSync(source, target)
  const restoredProblem = verifyDatabase(target)
  if (restoredProblem !== null) throw new Error(`恢复后的数据库仍不可用：${restoredProblem}`)
  return { restored: source, safety }
}
