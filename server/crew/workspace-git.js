import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { roomDir, roomRootOf } from './paths.js'
import { syncLocalEnvironment } from './workspace-fs.js'
import { chooseFreePort } from './workspace-ports.js'
import { workerIds } from './room-members.js'
import { isWithin } from './workspace-paths.js'

// 房间本地的运行文件不是交付内容：不进候选 commit、不进验收 diff。
export const LOCAL_ONLY = ['.crew', '.lodge', '.env', '.env.local', '.env.*', 'node_modules']
export const diffScope = ['.', ...LOCAL_ONLY.map(path => `:(exclude)${path}`)]

// 执行者可能自己 git add -A；worktree 级别的 excludes 让本地运行文件不会被误提交。
const LOCAL_EXCLUDES = ['.crew/', '.lodge/', '.env', '.env.*', '!.env.example', '!.env.sample', '!.env.template', 'node_modules/']
const EXAMPLE_ENV = new Set(['.env.example', '.env.sample', '.env.template'])
const isSecretName = name => name === '.env' || (name.startsWith('.env.') && !EXAMPLE_ENV.has(name))

// 仓库把 .env 跟踪进来时，验收 worktree 仍不应拿到它；删掉的是复核副本，不是源仓库。
const stripTrackedSecrets = path => {
  try {
    const listing = git(path, ['ls-files', '-z']).split('\0').filter(Boolean)
    for (const file of listing) {
      if (!isSecretName(basename(file))) continue
      try { rmSync(join(path, file), { force: true }) } catch {}
    }
  } catch {}
}

const ensureLocalExcludes = (path, base) => {
  try {
    const file = join(base, '.lodge-exclude')
    const content = `${LOCAL_EXCLUDES.join('\n')}\n`
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) writeFileSync(file, content)
    git(path, ['config', '--worktree', 'core.excludesFile', file])
  } catch {}
}
const enableWorktreeConfig = source => {
  try {
    git(source, ['config', 'extensions.worktreeConfig', 'true'])
  } catch {}
}

// git provider：当前唯一实现。业务只通过 workspace.js 的端口调用这些动作。
export const id = 'git'

const exec = promisify(execFile)
const MAX_OUTPUT = 64 * 1024
const MAX_BUFFER = 8 * 1024 * 1024
const clip = text => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…（输出已截断）` : text)

// 机器上没有全局 git 身份时，commit/merge 会直接失败；房间自己的记录统一用固定身份。
const GIT_IDENTITY = ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost']
// 默认 core.quotepath=true 会把中文文件名输出成 "\346..."；交付清单要的是原样路径。
const GIT_RAW_PATH = ['-c', 'core.quotepath=false']

const git = (cwd, args) => execFileSync('git', [...GIT_RAW_PATH, ...args], {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

const gitAsync = async (args, cwd) => {
  try {
    const { stdout } = await exec('git', [...GIT_RAW_PATH, ...args], { cwd, timeout: 20_000, maxBuffer: MAX_BUFFER })
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
    return { ok: false, error: '工作文件夹不是 git 仓库；先 git init，或留空让队长在临时仓库里判断' }
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
  execFileSync('git', [...GIT_IDENTITY, 'commit', '-q', '-m', 'room: initial'], { cwd: path })
  return path
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

// 每个成员一个工作区：worker 一个分支 worktree，verifier 一个 detached worktree，其余只读克隆。
export const prepareRoom = ({ source, short, members }) => {
  const base = join(scratchRoot(), short)
  try {
    ensureRepo(source)
    ensureDiskSpace(scratchRoot())
    mkdirSync(base, { recursive: true })
    enableWorktreeConfig(source)
    const byMember = {}
    const branches = {}
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
      if (member.role === 'worker') {
        const branch = `crew/${short}/${member.id}`
        git(source, ['worktree', 'add', '-b', branch, path, 'HEAD'])
        ensureLocalExcludes(path, base)
        branches[member.id] = branch
        byMember[member.id] = { path, kind: 'worktree', branch }
        environment[member.id] = syncLocalEnvironment(source, path)
        ports[member.id] = takePort()
        continue
      }
      if (member.role === 'verifier') {
        git(source, ['worktree', 'add', '--detach', path, 'HEAD'])
        ensureLocalExcludes(path, base)
        stripTrackedSecrets(path)
        byMember[member.id] = { path, kind: 'verify' }
        environment[member.id] = syncLocalEnvironment(source, path, { copyEnv: false })
        ports[member.id] = takePort()
        continue
      }
      execFileSync('git', ['clone', '--quiet', '--no-hardlinks', source, path], {
        cwd: base,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      byMember[member.id] = { path, kind: 'clone' }
    }
    const workers = members.filter(member => member.role === 'worker')
    // 多执行成员时，房间的交付目录是集成 worktree；各执行分支合并到这里，源仓库主分支不动。
    let integration = null
    if (workers.length > 1) {
      const path = join(base, 'integration')
      const branch = `crew/${short}/integration`
      git(source, ['worktree', 'add', '-b', branch, path, 'HEAD'])
      ensureLocalExcludes(path, base)
      integration = { path, branch, kind: 'worktree' }
      environment.integration = syncLocalEnvironment(source, path)
      ports.integration = takePort()
    }
    return {
      root: base,
      sourceRepo: source,
      members: byMember,
      branches,
      integration,
      ports,
      environment,
      primaryBranch: integration?.branch ?? branches[workers[0]?.id] ?? '',
      roomPath: integration?.path ?? byMember[workers[0]?.id]?.path,
    }
  } catch (error) {
    try { rmSync(base, { recursive: true, force: true }) } catch {}
    try { git(source, ['worktree', 'prune']) } catch {}
    throw error
  }
}

const roomShort = room => String(room?.id ?? '').replace(/^room-/, '') || 'room'
const nextMemberPort = room => {
  const used = Object.values(room?.ports ?? {}).filter(value => Number.isFinite(value))
  const start = used.length === 0 ? portBase() + portOffset(roomShort(room)) : Math.max(...used) + 10
  return chooseFreePort(start).port
}

// 建后加成员：沿用 prepareRoom 的隔离规则，只创建新增成员的工作区。
export const addMember = ({ room, member }) => {
  const source = room?.sourceRepo
  if (typeof source !== 'string' || source === '') throw new Error('房间没有源仓库，不能新增成员')
  const short = roomShort(room)
  const base = join(scratchRoot(), short)
  const path = join(base, member.id)
  if (existsSync(path)) throw new Error(`成员的工作文件夹已经有了：${member.id}`)
  mkdirSync(base, { recursive: true })
  enableWorktreeConfig(source)
  let branch = null
  if (member.role === 'worker') {
    branch = `crew/${short}/${member.id}`
    // 同一成员被移除后再加回来时，旧分支还在；先清掉，否则 worktree add -b 会失败。
    try {
      git(source, ['rev-parse', '--verify', `refs/heads/${branch}`])
      git(source, ['branch', '-D', branch])
    } catch {}
    git(source, ['worktree', 'add', '-b', branch, path, 'HEAD'])
    ensureLocalExcludes(path, base)
  } else if (member.role === 'verifier') {
    git(source, ['worktree', 'add', '--detach', path, 'HEAD'])
    ensureLocalExcludes(path, base)
    stripTrackedSecrets(path)
  } else {
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', source, path], {
      cwd: base,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  }
  return {
    path,
    branch,
    kind: member.role === 'worker' ? 'worktree' : member.role === 'verifier' ? 'verify' : 'clone',
    port: nextMemberPort(room),
    environment: syncLocalEnvironment(source, path, { copyEnv: member.role !== 'verifier' }),
  }
}

const memberPathOf = (room, member) => room?.worktrees?.[member?.id ?? member]

export const removeMember = ({ room, member }) => {
  const path = memberPathOf(room, member)
  if (typeof path !== 'string' || path === '') return false
  if (!isWithin(scratchRoot(), path)) return false
  try {
    git(room.sourceRepo, ['worktree', 'remove', '--force', path])
  } catch {
    rmSync(path, { recursive: true, force: true })
  }
  const branch = room?.branches?.[member?.id ?? member]
  if (typeof branch === 'string' && branch.startsWith(`crew/${roomShort(room)}/`)) {
    try { git(room.sourceRepo, ['branch', '-D', branch]) } catch {}
  }
  return true
}

export const head = ({ path }) => git(path, ['rev-parse', 'HEAD']).trim()

// 回退备份分支带时间戳；只清自己创建的 rewind/*，看不懂的一律保留。
export const pruneRewindBranches = ({ path, ttlMs = 7 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) => {
  if (typeof path !== 'string' || path === '' || !existsSync(path)) return 0
  let listing = ''
  try {
    listing = git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/rewind/'])
  } catch {
    return 0
  }
  let removed = 0
  for (const name of listing.split('\n').map(line => line.trim()).filter(Boolean)) {
    if (!name.startsWith('rewind/')) continue
    const stamp = Number(name.split('/').at(-1))
    if (!Number.isFinite(stamp) || stamp <= 0) continue
    if (now - stamp < ttlMs) continue
    try {
      git(path, ['branch', '-D', name])
      removed += 1
    } catch {}
  }
  return removed
}

// 回到某个阶段起点：先给当前 HEAD 和执行成员留备份分支，再重置；
// 有未提交的已跟踪改动就拒绝，避免把人的工作当临时结果丢掉。
export const restore = ({ room, base }) => {
  const repoPath = room?.repoPath
  if (typeof repoPath !== 'string' || repoPath === '') throw new Error('房间没有工作文件夹')
  if (!isWithin(scratchRoot(), repoPath)) throw new Error('房间工作文件夹不在工作区内，不能回退')
  const workers = workerIds(room)
  const memberPaths = Object.entries(room?.worktrees ?? {})
    .filter(([member, path]) => workers.includes(member) && typeof path === 'string' && existsSync(path) && isWithin(scratchRoot(), path))
  const targets = [{ name: 'room', path: repoPath }, ...memberPaths.map(([member, path]) => ({ name: member, path }))]
    .filter((item, index, list) => list.findIndex(other => other.path === item.path) === index)
  const dirty = targets.find(item => git(item.path, ['status', '--porcelain', '--untracked-files=no']).trim() !== '')
  if (dirty !== undefined) throw new Error(`还有没保存的改动：${dirty.path}；先等系统合并或清理，再回到这一步`)
  if (git(repoPath, ['cat-file', '-t', base]).trim() !== 'commit') {
    throw new Error('这一步的起点没有版本记录，不能回到这里')
  }
  const stamp = Date.now()
  const short = roomShort(room)
  const backups = targets.map(item => {
    const name = `rewind/${short}/${item.name}/${stamp}`
    git(repoPath, ['branch', name, git(item.path, ['rev-parse', 'HEAD']).trim()])
    return name
  })
  for (const item of targets) git(item.path, ['reset', '--hard', base])
  return { base, backups }
}

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
    git(path, [...GIT_IDENTITY, 'merge', '--no-edit', '--no-ff', branch])
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
// 并行成员在自己的 worktree 里工作；每次派发（含重做）先对齐到这一阶段的起点。
export const resetMemberWorktree = ({ path, ref, source }) => {
  if (typeof path !== 'string' || path === '' || typeof ref !== 'string' || ref === '') return false
  git(path, ['reset', '--hard', '-q', ref])
  // 不带 -x，并显式保留房间运行记录与本地环境；它们不是交付内容。
  git(path, ['clean', '-fd', '-q', '-e', '.crew', '-e', '.lodge', '-e', 'node_modules', '-e', '.env', '-e', '.env.*'])
  if (typeof source === 'string' && source !== '') syncLocalEnvironment(source, path, { copyEnv: false })
  return true
}

export const refreshReviewCopy = ({ path, branch, source }) => {
  if (typeof path !== 'string' || path === '' || !isWithin(scratchRoot(), path)) return
  git(path, ['checkout', '--detach', '--force', branch])
  git(path, ['clean', '-fdx'])
  stripTrackedSecrets(path)
  if (typeof source === 'string' && source !== '') syncLocalEnvironment(source, path, { copyEnv: false })
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
  // 只看真正 staged 的交付改动：工作树里只有 .crew/.env 时没有候选，不能把它当提交失败。
  const staged = git(path, ['diff', '--cached', '--name-only', '--', '.']).trim()
  if (staged === '') return null
  const message = `crew: candidate${turnId === undefined ? '' : ` ${turnId}`}${name ? ` · ${name}` : ''}`
  try {
    git(path, [...GIT_IDENTITY, 'commit', '-q', '-m', message])
  } catch (error) {
    if (/nothing to commit|no changes added to commit/i.test(String(error?.message ?? error))) {
      try {
        git(path, ['reset', '-q'])
      } catch {}
      return null
    }
    throw error
  }
  return git(path, ['rev-parse', 'HEAD']).trim()
}

// 完成/停止后清掉非交付成员工作区；保留房间交付仓库与候选分支，人仍可重建 worktree 查看。
export const pruneMembers = room => {
  const keep = typeof room.repoPath === 'string' && room.repoPath !== '' ? resolve(room.repoPath) : null
  const pruned = new Set(room.prunedMembers ?? [])
  for (const [member, path] of Object.entries(room.worktrees ?? {})) {
    if (typeof path !== 'string' || path === '') continue
    const target = resolve(path)
    if (!isWithin(scratchRoot(), target)) continue
    if (keep !== null && target === keep) continue
    if (pruned.has(member)) continue
    if (!existsSync(target)) {
      pruned.add(member)
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
    if (removed) pruned.add(member)
  }
  return [...pruned]
}

export const cleanupRoom = ({ source, workspaces }) => {
  if (!workspaces) return
  const items = [
    ...Object.values(workspaces.members ?? {}),
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

// 人工结果凭证没有验收命令，仍需要阶段起点到当前 HEAD 的文件清单。
export const changedFilesSince = ({ path, base }) => {
  if (typeof base !== 'string' || base === '') return []
  try {
    return git(path, ['diff', '--name-only', '--relative', `${base}..HEAD`, '--', ...diffScope])
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

export const changes = async ({ path }) => {
  // 房间自己的运行记录与本地环境不是交付内容，不进入验收 diff。
  const scope = diffScope
  const status = (await gitAsync(['status', '--porcelain', '--', ...scope], path)).trim()
  if (status === '') return { diff: '', status: '', note: '', files: [] }

  const inside = (await gitAsync(['rev-parse', '--is-inside-work-tree'], path)).trim()
  if (inside !== 'true') return { diff: '', status, note: '工作文件夹不是 git 仓库，无法生成 diff', files: [] }

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
    execFileSync('git', [...GIT_IDENTITY, 'commit', '-q', '-m', `room: ${room.name}`, '--', ...paths], { cwd: repo, stdio: 'ignore' })
    console.log(`room committed: ${room.id} ${paths.join(' ')}`)
    return true
  } catch (error) {
    console.error(`room commit failed: ${room.id} ${paths.join(' ')}`, error.stderr?.toString() ?? error.message)
    return false
  }
}
