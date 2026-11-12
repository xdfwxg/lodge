import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { roomDir, roomRootOf } from './paths.js'
import { syncLocalEnvironment } from './workspace-fs.js'
import { chooseFreePort } from './workspace-ports.js'

// 房间本地的运行文件不是交付内容：不进候选 commit、不进验收 diff。
export const LOCAL_ONLY = ['.crew', '.env', '.env.local', 'node_modules']
export const diffScope = ['.', ...LOCAL_ONLY.map(path => `:(exclude)${path}`)]

// git provider：当前唯一实现。业务只通过 workspace.js 的端口调用这些动作。
export const id = 'git'

const exec = promisify(execFile)
const MAX_OUTPUT = 64 * 1024
const MAX_BUFFER = 8 * 1024 * 1024
const clip = text => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…（输出已截断）` : text)

const git = (cwd, args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

const gitAsync = async (args, cwd) => {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: 20_000, maxBuffer: MAX_BUFFER })
    return stdout
  } catch (error) {
    return typeof error?.stdout === 'string' ? error.stdout : ''
  }
}

export const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

export const capabilities = () => ({
  vcs: 'git',
  isolation: 'worktree',
  diff: 'patch',
  candidate: true,
  merge: true,
  commit: gitAvailable,
  acceptanceCopy: true,
})

export const scratchRoot = () => (
  process.env.CREW_WORKTREE_ROOT === undefined
    ? join(homedir(), 'CrewWorktrees')
    : resolve(process.env.CREW_WORKTREE_ROOT)
)

export const probeSource = ({ source }) => {
  if (!gitAvailable) return { ok: false, error: '本机 git 不可用；先安装 git' }
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: source, stdio: 'ignore' })
    return { ok: true }
  } catch {
    return { ok: false, error: '工作目录不是 git 仓库；先 git init，或留空让队长在临时仓库里判断' }
  }
}

// 房间仓库：不存在就建一个带初始提交的 git 仓库，保证验收 diff 有 HEAD。
const ensureRepo = path => {
  mkdirSync(path, { recursive: true })
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: path, stdio: 'ignore' })
    return path
  } catch {}
  execFileSync('git', ['init', '-q'], { cwd: path })
  const readme = join(path, 'README.md')
  if (!existsSync(readme)) writeFileSync(readme, `# ${basename(path)}\n`)
  execFileSync('git', ['add', 'README.md'], { cwd: path })
  execFileSync('git', ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost', 'commit', '-q', '-m', 'room: initial'], { cwd: path })
  return path
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
export const prepareRoom = ({ source, short, seats }) => {
  ensureRepo(source)
  ensureDiskSpace(scratchRoot())
  const base = join(scratchRoot(), short)
  mkdirSync(base, { recursive: true })
  const bySeat = {}
  const branches = {}
  const ports = {}
  const environment = {}
  let nextPort = portBase() + portOffset(short)
  const takePort = () => {
    const chosen = chooseFreePort(nextPort)
    nextPort = chosen.next
    return chosen.port
  }
  for (const seat of seats) {
    const path = join(base, seat.id)
    if (seat.role === 'worker') {
      const branch = `crew/${short}/${seat.id}`
      git(source, ['worktree', 'add', '-b', branch, path, 'HEAD'])
      branches[seat.id] = branch
      bySeat[seat.id] = { path, kind: 'worktree', branch }
      environment[seat.id] = syncLocalEnvironment(source, path)
      ports[seat.id] = takePort()
      continue
    }
    if (seat.role === 'verifier') {
      git(source, ['worktree', 'add', '--detach', path, 'HEAD'])
      bySeat[seat.id] = { path, kind: 'verify' }
      environment[seat.id] = syncLocalEnvironment(source, path)
      ports[seat.id] = takePort()
      continue
    }
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', source, path], {
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
    git(source, ['worktree', 'add', '-b', branch, path, 'HEAD'])
    integration = { path, branch, kind: 'worktree' }
    environment.integration = syncLocalEnvironment(source, path)
    ports.integration = takePort()
  }
  return {
    root: base,
    sourceRepo: source,
    seats: bySeat,
    branches,
    integration,
    ports,
    environment,
    primaryBranch: integration?.branch ?? branches[workers[0]?.id] ?? '',
    roomPath: integration?.path ?? bySeat[workers[0]?.id]?.path,
  }
}

const roomShort = room => String(room?.id ?? '').replace(/^room-/, '') || 'room'
const nextSeatPort = room => {
  const used = Object.values(room?.ports ?? {}).filter(value => Number.isFinite(value))
  const start = used.length === 0 ? portBase() + portOffset(roomShort(room)) : Math.max(...used) + 10
  return chooseFreePort(start).port
}

// 建后加席位：沿用 prepareRoom 的隔离规则，只创建新增席位的工作区。
export const addSeat = ({ room, seat }) => {
  const source = room?.sourceRepo
  if (typeof source !== 'string' || source === '') throw new Error('房间没有源仓库，不能新增席位')
  const short = roomShort(room)
  const base = join(scratchRoot(), short)
  const path = join(base, seat.id)
  if (existsSync(path)) throw new Error(`席位工作区已存在：${seat.id}`)
  mkdirSync(base, { recursive: true })
  let branch = null
  if (seat.role === 'worker') {
    branch = `crew/${short}/${seat.id}`
    git(source, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  } else if (seat.role === 'verifier') {
    git(source, ['worktree', 'add', '--detach', path, 'HEAD'])
  } else {
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', source, path], {
      cwd: base,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  }
  return {
    path,
    branch,
    kind: seat.role === 'worker' ? 'worktree' : seat.role === 'verifier' ? 'verify' : 'clone',
    port: nextSeatPort(room),
    environment: syncLocalEnvironment(source, path),
  }
}

const seatPathOf = (room, seat) => room?.worktrees?.[seat?.id ?? seat]

export const removeSeat = ({ room, seat }) => {
  const path = seatPathOf(room, seat)
  if (typeof path !== 'string' || path === '') return false
  try {
    git(room.sourceRepo, ['worktree', 'remove', '--force', path])
  } catch {
    rmSync(path, { recursive: true, force: true })
  }
  return true
}

export const head = ({ path }) => git(path, ['rev-parse', 'HEAD']).trim()

// 验收命令在一次性 detached worktree 里跑；测试产生的文件不写回交付 worktree。
export const isolatedCopy = ({ source, ref }) => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-accept-'))
  const path = join(root, 'repo')
  try {
    git(source, ['worktree', 'add', '--detach', path, ref || 'HEAD'])
    return { root, path, ref: ref || 'HEAD', environment: syncLocalEnvironment(source, path) }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

export const removeIsolatedCopy = ({ source, copy }) => {
  try {
    git(source, ['worktree', 'remove', '--force', copy.path])
  } catch {}
  try {
    rmSync(copy.root, { recursive: true, force: true })
  } catch {}
}

// 把执行分支合进房间集成分支；冲突时回滚合并并把冲突文件交给人，不自动选边。
export const integrate = ({ path, branch }) => {
  try {
    git(path, ['merge', '--no-edit', '--no-ff', branch])
    return { ok: true }
  } catch (error) {
    let files = []
    try {
      files = git(path, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean)
    } catch {}
    try {
      git(path, ['merge', '--abort'])
    } catch {}
    return { ok: false, files, error: String(error?.stderr ?? error?.message ?? error).trim() }
  }
}

// 复核前把 verifier 目录重置到 executor 的最新候选提交；之前复核写下的东西全部丢掉，本地环境再同步。
export const refreshReviewCopy = ({ path, branch, source }) => {
  git(path, ['checkout', '--detach', '--force', branch])
  git(path, ['clean', '-fdx'])
  if (typeof source === 'string' && source !== '') syncLocalEnvironment(source, path)
}

// 复核前把执行改动提交成候选；房间运行记录与本地环境不进入候选 commit。
export const submit = ({ path, turnId, name }) => {
  // 不用 exclude pathspec：当 .env 被 .gitignore 忽略时，git add 会直接报 ignored 错误。
  git(path, ['add', '-A', '--', '.'])
  for (const item of LOCAL_ONLY) {
    try {
      git(path, ['reset', '-q', '--', item])
    } catch {}
  }
  const status = git(path, ['status', '--porcelain', '--', '.']).trim()
  if (status === '') return null
  const message = `crew: candidate${turnId === undefined ? '' : ` ${turnId}`}${name ? ` · ${name}` : ''}`
  git(path, ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost', 'commit', '-q', '-m', message])
  return git(path, ['rev-parse', 'HEAD']).trim()
}

// 完成/停止后清掉非交付席位工作区；保留房间交付仓库与候选分支，人仍可重建 worktree 查看。
export const pruneSeats = room => {
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

export const cleanupRoom = ({ source, workspaces }) => {
  if (!workspaces) return
  const items = [
    ...Object.values(workspaces.seats ?? {}),
    ...(workspaces.integration === undefined || workspaces.integration === null ? [] : [workspaces.integration]),
  ]
  for (const item of items) {
    if (item.kind === 'worktree' || item.kind === 'verify') {
      try {
        git(source, ['worktree', 'remove', '--force', item.path])
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
      git(source, ['branch', '-D', branch])
    } catch {}
  }
  rmSync(workspaces.root, { recursive: true, force: true })
}

// 并行执行的集成 diff：从派发时的基准提交到合并后的 HEAD。
export const rangeChanges = async ({ path, base }) => {
  if (typeof base !== 'string' || base === '') return { diff: '', files: [] }
  const scope = diffScope
  const diff = await gitAsync(['diff', `${base}..HEAD`, '--no-color', '--relative', '--', ...scope], path)
  const files = (await gitAsync(['diff', '--name-only', '--relative', `${base}..HEAD`, '--', ...scope], path))
    .split('\n')
    .filter(Boolean)
  return { diff: clip(diff), files }
}

export const changes = async ({ path }) => {
  // 房间自己的运行记录与本地环境不是交付内容，不进入验收 diff。
  const scope = diffScope
  const status = (await gitAsync(['status', '--porcelain', '--', ...scope], path)).trim()
  if (status === '') return { diff: '', status: '', note: '', files: [] }

  const inside = (await gitAsync(['rev-parse', '--is-inside-work-tree'], path)).trim()
  if (inside !== 'true') return { diff: '', status, note: '工作目录不是 git 仓库，无法生成 diff', files: [] }

  let diff = await gitAsync(['diff', 'HEAD', '--no-color', '--relative', '--', ...scope], path)
  const tracked = (await gitAsync(['diff', 'HEAD', '--name-only', '--relative', '--', ...scope], path))
    .split('\n')
    .filter(Boolean)
  const untracked = (await gitAsync(['ls-files', '--others', '--exclude-standard', '--', ...scope], path))
    .split('\n')
    .filter(Boolean)
  for (const file of untracked.slice(0, 20)) {
    diff += await gitAsync(['diff', '--no-index', '--no-color', '/dev/null', file], path)
  }
  const note = untracked.length > 20 ? `未跟踪文件 ${untracked.length} 个，diff 只取前 20 个` : ''
  return { diff: clip(diff), status, note, files: [...new Set([...tracked, ...untracked])].slice(0, 200) }
}

// 完成时的结论 commit：房间记录即使被 .gitignore 忽略也要跟着走；交付文件按正常忽略规则。
export const persistRoom = ({ room, files = [] }) => {
  const repo = roomRootOf(room)
  const rel = relative(repo, roomDir(room))
  if (rel === '' || rel.startsWith('..')) {
    console.error(`room commit skipped: ${room.id} 不在目标仓库 ${repo} 内`)
    return false
  }
  const canon = path => {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }
  const rootReal = canon(repo)
  const isLocalOnly = file => file.split(/[\\/]/).some(part => LOCAL_ONLY.includes(part))
  const extra = files
    .filter(file => typeof file === 'string' && file !== '')
    .map(file => relative(rootReal, canon(file)))
    .filter(file => file !== '' && !file.startsWith('..') && !file.startsWith('/') && !isLocalOnly(file))
  const paths = [...new Set([rel, ...extra])]
  try {
    execFileSync('git', ['add', '-f', '-A', '--', rel], { cwd: repo, stdio: 'ignore' })
    if (extra.length > 0) execFileSync('git', ['add', '-A', '--', ...extra], { cwd: repo, stdio: 'ignore' })
    const status = execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd: repo, encoding: 'utf8' })
    if (status.trim() === '') return true
    execFileSync('git', ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost', 'commit', '-q', '-m', `room: ${room.name}`, '--', ...paths], { cwd: repo, stdio: 'ignore' })
    console.log(`room committed: ${room.id} ${paths.join(' ')}`)
    return true
  } catch (error) {
    console.error(`room commit failed: ${room.id} ${paths.join(' ')}`, error.stderr?.toString() ?? error.message)
    return false
  }
}
