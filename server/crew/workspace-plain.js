import { existsSync, mkdirSync, mkdtempSync, rmSync, statfsSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { copyEntry, copyWorkspace, manifestDigest, manifestOf, syncLocalEnvironment } from './workspace-fs.js'
import { chooseFreePort } from './workspace-ports.js'
import { isWithin } from './workspace-paths.js'

// 普通目录 provider：复制隔离、文件清单证据、复制合并；不产生分支或 commit。
export const id = 'plain'

export const capabilities = () => ({
  vcs: 'none',
  isolation: 'copy',
  diff: 'manifest',
  candidate: false,
  merge: true,
  commit: false,
  acceptanceCopy: true,
})

export const scratchRoot = () => (
  process.env.CREW_COPY_ROOT === undefined
    ? join(homedir(), 'LodgeCopies')
    : resolve(process.env.CREW_COPY_ROOT)
)

export const probeSource = ({ source }) => {
  if (typeof source !== 'string' || source === '' || !existsSync(source)) {
    return { ok: false, error: '工作文件夹不存在' }
  }
  try {
    if (!statSync(source).isDirectory()) return { ok: false, error: '工作文件夹不是目录' }
  } catch {
    return { ok: false, error: '工作文件夹不可读' }
  }
  return { ok: true }
}

const diskMinMb = () => Number(process.env.CREW_DISK_MIN_FREE_MB ?? 512)

const ensureDiskSpace = path => {
  const min = diskMinMb()
  if (!Number.isFinite(min) || min <= 0) return
  try {
    mkdirSync(path, { recursive: true })
  } catch {
    return
  }
  let free
  try {
    const stat = statfsSync(path)
    free = stat.bavail * stat.bsize
  } catch {
    return
  }
  if (free < min * 1024 * 1024) {
    throw new Error(`磁盘可用空间不足：至少需要 ${min}MB，当前 ${Math.round(free / 1024 / 1024)}MB`)
  }
}

const portBase = () => {
  const value = Number(process.env.CREW_WORKTREE_PORT_BASE ?? 4100)
  return Number.isFinite(value) ? value : 4100
}

const portOffset = short => {
  let hash = 0
  for (const char of short) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (hash % 40) * 10
}

export const prepareRoom = ({ source, short, members }) => {
  const base = join(scratchRoot(), short)
  try {
    ensureDiskSpace(scratchRoot())
    mkdirSync(base, { recursive: true })
    const byMember = {}
    const ports = {}
    const environment = {}
    let nextPort = portBase() + portOffset(short)
    const takePort = () => {
      const chosen = chooseFreePort(nextPort)
      nextPort = chosen.next
      return chosen.port
    }
    for (const member of members) {
      const path = join(base, member.id)
      copyWorkspace(source, path)
      byMember[member.id] = { path, kind: 'copy' }
      environment[member.id] = syncLocalEnvironment(source, path, { copyEnv: member.role !== 'verifier' })
      ports[member.id] = takePort()
    }
    const workers = members.filter(member => member.role === 'worker')
    let integration = null
    if (workers.length > 1) {
      const path = join(base, 'integration')
      // 集成目录从空开始：每个 worker 都是完整副本，合并时只按文件写入，
      // 冲突只发生在两个 worker 改了同一路径且内容不同，而不是与源目录基线比。
      mkdirSync(path, { recursive: true })
      integration = { path, kind: 'copy' }
      environment.integration = syncLocalEnvironment(source, path)
      ports.integration = takePort()
    }
    return {
      root: base,
      sourceRepo: source,
      members: byMember,
      branches: {},
      integration,
      ports,
      environment,
      primaryBranch: '',
      roomPath: integration?.path ?? byMember[workers[0]?.id]?.path,
    }
  } catch (error) {
    try { rmSync(base, { recursive: true, force: true }) } catch {}
    throw error
  }
}

const roomShort = room => String(room?.id ?? '').replace(/^room-/, '') || 'room'
const nextMemberPort = room => {
  const used = Object.values(room?.ports ?? {}).filter(value => Number.isFinite(value))
  const start = used.length === 0 ? portBase() + portOffset(roomShort(room)) : Math.max(...used) + 10
  return chooseFreePort(start).port
}

export const addMember = ({ room, member }) => {
  const source = room?.sourceRepo
  if (typeof source !== 'string' || source === '') throw new Error('房间没有源目录，不能新增成员')
  const path = join(scratchRoot(), roomShort(room), member.id)
  if (existsSync(path)) throw new Error(`成员的工作文件夹已经有了：${member.id}`)
  copyWorkspace(source, path)
  return {
    path,
    branch: null,
    kind: 'copy',
    port: nextMemberPort(room),
    environment: syncLocalEnvironment(source, path, { copyEnv: member.role !== 'verifier' }),
  }
}

export const removeMember = ({ room, member }) => {
  const path = room?.worktrees?.[member?.id ?? member]
  if (typeof path !== 'string' || path === '') return false
  if (!isWithin(scratchRoot(), path)) return false
  rmSync(path, { recursive: true, force: true })
  return true
}

export const head = ({ path }) => manifestDigest(manifestOf(path))

export const changes = async ({ path }) => {
  const manifest = manifestOf(path)
  return {
    diff: '',
    status: '',
    note: '非 git 工作区：记录文件清单，没有 diff',
    files: manifest.map(item => item.path).slice(0, 200),
    manifest: manifest.slice(0, 200),
  }
}

export const rangeChanges = async ({ path }) => changes({ path })

// 复制合并：同路径不同内容视为冲突，不自动选边；删除不传播，需人工处理。
export const integrate = ({ path, source }) => {
  if (typeof source !== 'string' || source === '') return { ok: false, files: [], error: '缺少合并来源' }
  const incoming = manifestOf(source)
  const current = new Map(manifestOf(path).map(item => [item.path, item.sha256]))
  const conflicts = incoming
    .filter(item => current.has(item.path) && current.get(item.path) !== item.sha256)
    .map(item => item.path)
  if (conflicts.length > 0) return { ok: false, files: conflicts.slice(0, 50), error: '复制合并冲突' }
  for (const item of incoming) {
    if (current.get(item.path) === item.sha256) continue
    copyEntry(source, path, item.path)
  }
  return { ok: true }
}

export const refreshReviewCopy = ({ path, from }) => {
  if (typeof from !== 'string' || from === '' || path === from) return
  if (typeof path !== 'string' || path === '' || !isWithin(scratchRoot(), path)) return
  rmSync(path, { recursive: true, force: true })
  copyWorkspace(from, path)
  syncLocalEnvironment(from, path, { copyEnv: false })
}

export const isolatedCopy = ({ source }) => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-accept-'))
  const path = join(root, 'workspace')
  try {
    copyWorkspace(source, path)
    return { root, path, ref: 'copy', environment: syncLocalEnvironment(source, path) }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

export const removeIsolatedCopy = ({ copy }) => {
  try {
    rmSync(copy.root, { recursive: true, force: true })
  } catch {}
}

export const submit = () => null

export const pruneMembers = room => {
  const keep = typeof room.repoPath === 'string' && room.repoPath !== '' ? resolve(room.repoPath) : null
  const pruned = new Set(room.prunedMembers ?? [])
  for (const [member, path] of Object.entries(room.worktrees ?? {})) {
    if (typeof path !== 'string' || path === '') continue
    const target = resolve(path)
    if (!isWithin(scratchRoot(), target)) continue
    if (keep !== null && target === keep) continue
    if (pruned.has(member)) continue
    rmSync(target, { recursive: true, force: true })
    pruned.add(member)
  }
  return [...pruned]
}

export const cleanupRoom = ({ workspaces }) => {
  if (!workspaces) return
  const items = [
    ...Object.values(workspaces.members ?? {}),
    ...(workspaces.integration === undefined || workspaces.integration === null ? [] : [workspaces.integration]),
  ]
  for (const item of items) rmSync(item.path, { recursive: true, force: true })
  rmSync(workspaces.root, { recursive: true, force: true })
}

export const persistRoom = () => true
