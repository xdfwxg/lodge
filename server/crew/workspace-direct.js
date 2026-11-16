import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { copyWorkspace } from './workspace-fs.js'
import { isWithin } from './workspace-paths.js'
import { chooseFreePort } from './workspace-ports.js'
import {
  changes as manifestChanges,
  head as manifestHead,
  isolatedCopy,
  probeSource,
  removeIsolatedCopy,
  scratchRoot as copyRoot,
} from './workspace-plain.js'

// 用户选中的普通目录就是工作区：原地修改，不复制、不新建 worker 目录。
export const id = 'direct'

export const capabilities = () => ({
  vcs: 'none',
  isolation: 'direct',
  diff: 'manifest',
  candidate: false,
  merge: false,
  commit: false,
  acceptanceCopy: true,
})

export { probeSource, isolatedCopy, removeIsolatedCopy }

const portBase = () => {
  const value = Number(process.env.CREW_WORKTREE_PORT_BASE ?? 4100)
  return Number.isFinite(value) ? value : 4100
}

const portOffset = short => {
  let hash = 0
  for (const char of short) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (hash % 40) * 10
}

const roomShort = room => String(room?.id ?? '').replace(/^room-/, '') || 'room'

const nextPort = (start, used = 0) => {
  let port = start
  if (used > 0) port = Math.max(used + 10, start)
  return chooseFreePort(port).port
}

export const prepareRoom = ({ source, short, members }) => {
  const byMember = {}
  const ports = {}
  const environment = {}
  let cursor = portBase() + portOffset(short)
  try {
    for (const member of members) {
      const chosen = chooseFreePort(cursor)
      cursor = chosen.next
      if (member.role === 'verifier') {
        // 原地目录的验收员看一份不含 .env/node_modules 的快照，避免直接读源目录秘密。
        const path = join(copyRoot(), `direct-${short}`, member.id)
        mkdirSync(path, { recursive: true })
        copyWorkspace(source, path)
        byMember[member.id] = { path, kind: 'copy' }
      } else {
        byMember[member.id] = { path: source, kind: 'direct' }
      }
      environment[member.id] = { copied: [], linked: [], warnings: [] }
      ports[member.id] = chosen.port
    }
    return {
      root: source,
      sourceRepo: source,
      members: byMember,
      branches: {},
      integration: null,
      ports,
      environment,
      primaryBranch: '',
      roomPath: source,
    }
  } catch (error) {
    try { rmSync(join(copyRoot(), `direct-${short}`), { recursive: true, force: true }) } catch {}
    throw error
  }
}

export const addMember = ({ room, member }) => {
  if (member.role === 'worker') throw new Error('普通目录原地修改只能有一个执行成员')
  const source = room?.sourceRepo
  const used = Math.max(0, ...Object.values(room?.ports ?? {}).filter(value => Number.isFinite(value)))
  if (member.role === 'verifier') {
    const path = join(copyRoot(), `direct-${roomShort(room)}`, member.id)
    mkdirSync(path, { recursive: true })
    copyWorkspace(source, path)
    return { path, branch: null, kind: 'copy', port: nextPort(portBase(), used), environment: { copied: [], linked: [], warnings: [] } }
  }
  return {
    path: source,
    branch: null,
    kind: 'direct',
    port: nextPort(portBase(), used),
    environment: { copied: [], linked: [], warnings: [] },
  }
}

export const removeMember = ({ room, member }) => {
  const path = room?.worktrees?.[member?.id ?? member]
  if (typeof path !== 'string' || path === '') return false
  if (path === room?.sourceRepo || !isWithin(copyRoot(), path)) return false
  rmSync(path, { recursive: true, force: true })
  return true
}

export const head = ({ path }) => manifestHead({ path })

export const changes = ({ path }) => manifestChanges({ path })

export const rangeChanges = ({ path }) => manifestChanges({ path })

export const integrate = () => ({ ok: false, files: [], error: '原地目录不支持并行合并' })

export const refreshReviewCopy = ({ path, from }) => {
  if (typeof from !== 'string' || from === '') return
  if (typeof path !== 'string' || path === '' || path === from || !isWithin(copyRoot(), path)) return
  rmSync(path, { recursive: true, force: true })
  mkdirSync(path, { recursive: true })
  copyWorkspace(from, path)
}

export const submit = () => null

export const pruneMembers = room => {
  const pruned = new Set(room?.prunedMembers ?? [])
  for (const [member, path] of Object.entries(room?.worktrees ?? {})) {
    if (typeof path !== 'string' || path === '' || path === room?.sourceRepo) continue
    if (!isWithin(copyRoot(), path)) continue
    if (!room?.worktrees?.[member]) continue
    rmSync(path, { recursive: true, force: true })
    pruned.add(member)
  }
  return [...pruned]
}

export const cleanupRoom = ({ workspaces }) => {
  if (!workspaces) return
  for (const item of Object.values(workspaces.members ?? {})) {
    if (item?.path === workspaces.sourceRepo || !isWithin(copyRoot(), item?.path ?? '')) continue
    rmSync(item.path, { recursive: true, force: true })
  }
}

export const persistRoom = () => true
