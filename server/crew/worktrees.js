import { execFileSync } from 'node:child_process'
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statfsSync, statSync, symlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureRepo } from './room-repo.js'
import { LOCAL_ONLY } from './workspace-paths.js'

const git = (cwd, args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

const root = () => (
  process.env.CREW_WORKTREE_ROOT === undefined
    ? join(homedir(), 'CrewWorktrees')
    : resolve(process.env.CREW_WORKTREE_ROOT)
)

export const worktreeRootPath = root

const ENV_FILES = ['.env', '.env.local']
const LINK_DIRS = ['node_modules']

// .env 是复制，node_modules 是软链；两者都不进候选 commit 与验收 diff。
export const syncLocalEnvironment = (source, target) => {
  const copied = []
  const linked = []
  const warnings = []
  for (const name of ENV_FILES) {
    const from = join(source, name)
    const to = join(target, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      copyFileSync(from, to)
      chmodSync(to, statSync(from).mode & 0o777)
      copied.push(name)
    } catch (error) {
      warnings.push(`${name}: ${error?.message ?? error}`)
    }
  }
  for (const name of LINK_DIRS) {
    const from = resolve(source, name)
    const to = join(target, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      symlinkSync(from, to, 'dir')
      linked.push(name)
    } catch (error) {
      warnings.push(`${name}: ${error?.message ?? error}`)
    }
  }
  return { copied, linked, warnings }
}

const diskMinMb = () => Number(process.env.CREW_DISK_MIN_FREE_MB ?? 512)

const ensureDiskSpace = path => {
  const min = diskMinMb()
  if (!Number.isFinite(min) || min <= 0) return
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

// 每个席位一个工作区：worker 一个分支 worktree，verifier 一个 detached worktree，其余只读克隆。
export const prepareWorkspaces = ({ sourceRepo, short, seats }) => {
  ensureRepo(sourceRepo)
  ensureDiskSpace(root())
  const base = join(root(), short)
  mkdirSync(base, { recursive: true })
  const bySeat = {}
  const branches = {}
  const ports = {}
  const environment = {}
  let nextPort = portBase() + portOffset(short)
  const takePort = () => {
    const port = nextPort
    nextPort += 10
    return port
  }
  for (const seat of seats) {
    const path = join(base, seat.id)
    if (seat.role === 'worker') {
      const branch = `crew/${short}/${seat.id}`
      git(sourceRepo, ['worktree', 'add', '-b', branch, path, 'HEAD'])
      branches[seat.id] = branch
      bySeat[seat.id] = { path, kind: 'worktree', branch }
      environment[seat.id] = syncLocalEnvironment(sourceRepo, path)
      ports[seat.id] = takePort()
      continue
    }
    if (seat.role === 'verifier') {
      git(sourceRepo, ['worktree', 'add', '--detach', path, 'HEAD'])
      bySeat[seat.id] = { path, kind: 'verify' }
      environment[seat.id] = syncLocalEnvironment(sourceRepo, path)
      ports[seat.id] = takePort()
      continue
    }
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', sourceRepo, path], {
      cwd: base,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    bySeat[seat.id] = { path, kind: 'clone' }
  }
  const workers = seats.filter(seat => seat.role === 'worker')
  // 多执行席位时，房间的交付目录是集成 worktree；各执行分支合并到这里，源仓库主分支不动。
  let integration = null
  if (workers.length > 1) {
    const path = join(base, 'integration')
    const branch = `crew/${short}/integration`
    git(sourceRepo, ['worktree', 'add', '-b', branch, path, 'HEAD'])
    integration = { path, branch, kind: 'worktree' }
    environment.integration = syncLocalEnvironment(sourceRepo, path)
    ports.integration = takePort()
  }
  return {
    root: base,
    sourceRepo,
    seats: bySeat,
    branches,
    integration,
    ports,
    environment,
    primaryBranch: integration?.branch ?? branches[workers[0]?.id] ?? '',
    roomPath: integration?.path ?? bySeat[workers[0]?.id]?.path,
  }
}

export const headOf = cwd => git(cwd, ['rev-parse', 'HEAD']).trim()

// 把执行分支合进房间集成分支；冲突时回滚合并并把冲突文件交给人，不自动选边。
export const mergeBranch = ({ worktree, branch }) => {
  try {
    git(worktree, ['merge', '--no-edit', '--no-ff', branch])
    return { ok: true }
  } catch (error) {
    let files = []
    try {
      files = git(worktree, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)
    } catch {}
    try {
      git(worktree, ['merge', '--abort'])
    } catch {}
    return { ok: false, files, error: String(error?.stderr ?? error?.message ?? error).trim() }
  }
}

// 复核前把 verifier 目录重置到 executor 的最新候选提交；之前复核写下的东西全部丢掉，本地环境再同步。
export const refreshVerifier = ({ verifier, branch, sourceRepo }) => {
  git(verifier, ['checkout', '--detach', '--force', branch])
  git(verifier, ['clean', '-fdx'])
  if (typeof sourceRepo === 'string' && sourceRepo !== '') syncLocalEnvironment(sourceRepo, verifier)
}

// 复核前把执行改动提交成候选；房间运行记录与本地环境不进入候选 commit。
export const commitCandidate = ({ executor, turnId, name }) => {
  // 不用 exclude pathspec：当 .env 被 .gitignore 忽略时，git add 会直接报 ignored 错误。
  git(executor, ['add', '-A', '--', '.'])
  for (const path of LOCAL_ONLY) {
    try {
      git(executor, ['reset', '-q', '--', path])
    } catch {}
  }
  const status = git(executor, ['status', '--porcelain', '--', '.']).trim()
  if (status === '') return null
  const message = `crew: candidate${turnId === undefined ? '' : ` ${turnId}`}${name ? ` · ${name}` : ''}`
  git(executor, ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost', 'commit', '-q', '-m', message])
  return git(executor, ['rev-parse', 'HEAD']).trim()
}

// 完成/停止后清掉非交付席位工作区；保留房间交付仓库与候选分支，人仍可重建 worktree 查看。
export const pruneSeatWorkspaces = room => {
  const keep = typeof room.repoPath === 'string' && room.repoPath !== '' ? resolve(room.repoPath) : null
  const pruned = new Set(room.prunedSeats ?? [])
  for (const [seat, path] of Object.entries(room.worktrees ?? {})) {
    if (typeof path !== 'string' || path === '') continue
    const target = resolve(path)
    if (keep !== null && target === keep) continue
    if (pruned.has(seat)) continue
    if (!existsSync(target)) {
      pruned.add(seat)
      continue
    }
    let removed = false
    if (typeof room.sourceRepo === 'string' && room.sourceRepo !== '') {
      try {
        git(room.sourceRepo, ['worktree', 'remove', '--force', target])
        removed = true
      } catch {}
    }
    if (!removed) {
      try {
        rmSync(target, { recursive: true, force: true })
        removed = true
      } catch {}
    }
    if (removed) pruned.add(seat)
  }
  return [...pruned]
}

export const cleanupWorkspaces = ({ sourceRepo, workspaces }) => {
  if (!workspaces) return
  const items = [
    ...Object.values(workspaces.seats ?? {}),
    ...(workspaces.integration === undefined || workspaces.integration === null ? [] : [workspaces.integration]),
  ]
  for (const item of items) {
    if (item.kind === 'worktree' || item.kind === 'verify') {
      try {
        git(sourceRepo, ['worktree', 'remove', '--force', item.path])
      } catch {}
    } else {
      rmSync(item.path, { recursive: true, force: true })
    }
  }
  const branches = [
    ...Object.values(workspaces.branches ?? {}),
    ...(workspaces.integration === undefined || workspaces.integration === null ? [] : [workspaces.integration.branch]),
  ]
  for (const branch of branches) {
    try {
      git(sourceRepo, ['branch', '-D', branch])
    } catch {}
  }
  rmSync(workspaces.root, { recursive: true, force: true })
}
