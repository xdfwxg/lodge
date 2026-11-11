import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureRepo } from './room-repo.js'

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

// 每个席位一个工作区：worker 一个分支 worktree，verifier 一个 detached worktree，其余只读克隆。
export const prepareWorkspaces = ({ sourceRepo, short, seats }) => {
  ensureRepo(sourceRepo)
  const base = join(root(), short)
  mkdirSync(base, { recursive: true })
  const bySeat = {}
  const branches = {}
  for (const seat of seats) {
    const path = join(base, seat.id)
    if (seat.role === 'worker') {
      const branch = `crew/${short}/${seat.id}`
      git(sourceRepo, ['worktree', 'add', '-b', branch, path, 'HEAD'])
      branches[seat.id] = branch
      bySeat[seat.id] = { path, kind: 'worktree', branch }
      continue
    }
    if (seat.role === 'verifier') {
      git(sourceRepo, ['worktree', 'add', '--detach', path, 'HEAD'])
      bySeat[seat.id] = { path, kind: 'verify' }
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
  }
  return {
    root: base,
    sourceRepo,
    seats: bySeat,
    branches,
    integration,
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

// 复核前把 verifier 目录重置到 executor 的最新候选提交；之前复核写下的东西全部丢掉。
export const refreshVerifier = ({ verifier, branch }) => {
  git(verifier, ['checkout', '--detach', '--force', branch])
  git(verifier, ['clean', '-fdx'])
}

// 复核前把执行改动提交成候选；房间自己的 .crew 不进入候选 commit。
export const commitCandidate = ({ executor, turnId, name }) => {
  const scope = ['.', ':(exclude).crew']
  git(executor, ['add', '-A', '--', ...scope])
  const status = git(executor, ['status', '--porcelain', '--', ...scope]).trim()
  if (status === '') return null
  const message = `crew: candidate${turnId === undefined ? '' : ` ${turnId}`}${name ? ` · ${name}` : ''}`
  git(executor, ['-c', 'user.name=Crew Chat', '-c', 'user.email=crew@localhost', 'commit', '-q', '-m', message])
  return git(executor, ['rev-parse', 'HEAD']).trim()
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
