import { chooseFreePort } from './workspace-ports.js'
import {
  changes as manifestChanges,
  head as manifestHead,
  isolatedCopy,
  probeSource,
  removeIsolatedCopy,
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

const nextPort = (start, used = 0) => {
  let port = start
  if (used > 0) port = Math.max(used + 10, start)
  return chooseFreePort(port).port
}

export const prepareRoom = ({ source, short, seats }) => {
  const bySeat = {}
  const ports = {}
  const environment = {}
  let cursor = portBase() + portOffset(short)
  for (const seat of seats) {
    const chosen = chooseFreePort(cursor)
    cursor = chosen.next
    bySeat[seat.id] = { path: source, kind: 'direct' }
    environment[seat.id] = { copied: [], linked: [], warnings: [] }
    ports[seat.id] = chosen.port
  }
  return {
    root: source,
    sourceRepo: source,
    seats: bySeat,
    branches: {},
    integration: null,
    ports,
    environment,
    primaryBranch: '',
    roomPath: source,
  }
}

export const addSeat = ({ room, seat }) => {
  if (seat.role === 'worker') throw new Error('普通目录原地修改只能有一个执行席位')
  const source = room?.sourceRepo
  const used = Math.max(0, ...Object.values(room?.ports ?? {}).filter(value => Number.isFinite(value)))
  return {
    path: source,
    branch: null,
    kind: 'direct',
    port: nextPort(portBase(), used),
    environment: { copied: [], linked: [], warnings: [] },
  }
}

export const removeSeat = () => false

export const head = ({ path }) => manifestHead({ path })

export const changes = ({ path }) => manifestChanges({ path })

export const rangeChanges = ({ path }) => manifestChanges({ path })

export const integrate = () => ({ ok: false, files: [], error: '原地目录不支持并行合并' })

export const refreshReviewCopy = () => {}

export const submit = () => null

export const pruneSeats = room => [...(room?.prunedSeats ?? [])]

export const cleanupRoom = () => {}

export const persistRoom = () => true
