import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const databaseFile = dataDir => join(dataDir, 'crew.db')
export const backupsDir = dataDir => join(dataDir, 'backups')
export const memoryDir = dataDir => join(dataDir, 'memory')

const check = file => {
  let db = null
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const value = db.prepare('PRAGMA integrity_check').get()?.integrity_check
    return value === 'ok' ? null : `数据检查没通过：${value ?? '未知'}`
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

export const listMemoryBackups = dataDir => {
  const dir = backupsDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.startsWith('memory-'))
    .map(name => {
      const file = join(dir, name)
      const info = statSync(file)
      return { name, file, mtimeMs: info.mtimeMs, directory: info.isDirectory() }
    })
    .filter(item => item.directory)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map(({ name, file, mtimeMs }) => ({ name, file, mtimeMs }))
}

export const pruneMemoryBackups = (dataDir, keep = 10) => {
  const size = Math.max(1, Number(keep) || 10)
  const old = listMemoryBackups(dataDir).slice(size)
  for (const item of old) {
    try { rmSync(item.file, { recursive: true, force: true }) } catch {}
  }
  return old.length
}

// 房间记忆是追加式 JSONL，与数据库分开备份；恢复时把它拷回 .data/memory 即可。
export const snapshotMemory = ({ dataDir, reason = 'manual', keep = 10, now = Date.now() }) => {
  const source = memoryDir(dataDir)
  if (!existsSync(source)) return null
  const dir = backupsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const safeReason = String(reason).replace(/[^\w-]/g, '-').slice(0, 24) || 'manual'
  const target = join(dir, `memory-${now}-${safeReason}`)
  if (existsSync(target)) return target
  cpSync(source, target, { recursive: true })
  pruneMemoryBackups(dataDir, keep)
  return target
}

// 工作区是 Lodge 自己的工作副本；重置前先整份归档，恢复时和数据库成对拿回。
export const listWorkspaceArchives = dataDir => {
  const dir = backupsDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.startsWith('workspaces-'))
    .map(name => {
      const folder = join(dir, name)
      const manifest = join(folder, 'manifest.json')
      if (!existsSync(manifest)) return null
      try {
        const info = JSON.parse(readFileSync(manifest, 'utf8'))
        return { name, folder, createdAt: Number(info.createdAt) || 0, entries: Array.isArray(info.entries) ? info.entries : [] }
      } catch {
        return null
      }
    })
    .filter(item => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

export const latestWorkspaceArchive = dataDir => listWorkspaceArchives(dataDir)[0] ?? null

export const pruneWorkspaceArchives = (dataDir, keep = 10) => {
  const size = Math.max(1, Number(keep) || 10)
  const old = listWorkspaceArchives(dataDir).slice(size)
  for (const item of old) {
    try { rmSync(item.folder, { recursive: true, force: true }) } catch {}
  }
  return old.length
}

export const archiveWorkspaces = ({ dataDir, roots, now = Date.now(), keep = 10 }) => {
  const existing = (roots ?? []).filter(item => (
    typeof item?.kind === 'string' && typeof item?.path === 'string' && item.path !== '' && existsSync(item.path)
  ))
  if (existing.length === 0) return null
  const folder = join(backupsDir(dataDir), `workspaces-${now}`)
  mkdirSync(folder, { recursive: true })
  const entries = []
  for (const item of existing) {
    cpSync(item.path, join(folder, item.kind), { recursive: true })
    entries.push({ kind: item.kind, name: basename(item.path) })
  }
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ version: 1, createdAt: now, entries }, null, 2))
  pruneWorkspaceArchives(dataDir, keep)
  return folder
}

export const resolveWorkspaceArchive = (dataDir, value) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const raw = value.trim()
  if (raw.includes('/') || raw.includes(sep)) return resolve(raw)
  return join(backupsDir(dataDir), raw)
}

export const restoreWorkspaceArchive = ({ dataDir, archive, roots, force = false, now = Date.now() }) => {
  const folder = resolveWorkspaceArchive(dataDir, archive)
  if (folder === null || !existsSync(join(folder, 'manifest.json'))) throw new Error(`工作区归档不存在：${folder}`)
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
  const targets = new Map((roots ?? []).map(item => [item.kind, item.path]))
  const plans = (manifest.entries ?? []).map(entry => {
    const target = targets.get(entry.kind)
    if (typeof target !== 'string' || target === '') throw new Error(`不知道 ${entry.kind} 恢复到哪`)
    return { source: join(folder, entry.kind), target }
  })
  const occupied = plans.filter(item => existsSync(item.target))
  if (occupied.length > 0 && force !== true) {
    throw new Error(`工作区已经存在：${occupied.map(item => item.target).join('、')}；加 --force 覆盖`)
  }
  // 恢复前的安全副本不能顺手把正在恢复的旧归档裁掉。
  const safety = archiveWorkspaces({ dataDir, roots: roots ?? [], now, keep: 1000 })
  for (const item of plans) {
    if (existsSync(item.target)) rmSync(item.target, { recursive: true, force: true })
    mkdirSync(join(item.target, '..'), { recursive: true })
    cpSync(item.source, item.target, { recursive: true })
  }
  return { restored: folder, safety, roots: plans.map(item => item.target) }
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
