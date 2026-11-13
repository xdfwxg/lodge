import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  cleanupRoom, head, integrate, isolatedCopy, prepareRoom, pruneSeats, rangeChanges,
  refreshReviewCopy, removeIsolatedCopy, submit,
} from './workspace-git.js'
import { rosterFromRoles, seatsFor } from './seats.js'

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-worktree-src-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

test('acceptance runs in a disposable copy and cannot write the source repo', () => {
  const sourceRepo = repo()
  const copy = isolatedCopy({ source: sourceRepo, ref: head({ path: sourceRepo }) })
  try {
    assert.equal(existsSync(copy.path), true)
    assert.equal(readFileSync(join(copy.path, 'README.md'), 'utf8'), '# test\n')
    writeFileSync(join(copy.path, 'side-effect.txt'), 'discard\n')
    assert.equal(existsSync(join(sourceRepo, 'side-effect.txt')), false)
  } finally {
    removeIsolatedCopy({ source: sourceRepo, copy })
    rmSync(sourceRepo, { recursive: true, force: true })
  }
  assert.equal(existsSync(copy.path), false)
})

test('prepares isolated seat workspaces and refreshes the verifier copy', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-worktrees-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    workspaces = prepareRoom({ source: sourceRepo, short: 'abc123', seats: seatsFor('delivery-triad') })
    const executor = workspaces.seats.executor.path
    const verifier = workspaces.seats.verifier.path
    assert.equal(existsSync(executor), true)
    assert.equal(existsSync(workspaces.seats.planner.path), true)
    assert.equal(existsSync(verifier), true)

    writeFileSync(join(executor, 'hello.txt'), 'crew ok\n')
    const commit = submit({ path: executor, turnId: 't1', name: 'Room' })
    assert.equal(typeof commit, 'string')
    assert.equal(submit({ path: executor, turnId: 't2', name: 'Room' }), null)
    mkdirSync(join(executor, '.crew', 'rooms'), { recursive: true })
    writeFileSync(join(executor, '.crew', 'rooms', 'state.json'), '{}\n')
    assert.equal(submit({ path: executor, turnId: 't3', name: 'Room' }), null)
    refreshReviewCopy({ path: verifier, branch: workspaces.branches.executor })
    assert.equal(readFileSync(join(verifier, 'hello.txt'), 'utf8'), readFileSync(join(executor, 'hello.txt'), 'utf8'))

    writeFileSync(join(verifier, 'scratch.txt'), 'discard me\n')
    refreshReviewCopy({ path: verifier, branch: workspaces.branches.executor })
    assert.equal(existsSync(join(verifier, 'scratch.txt')), false)
    assert.equal(readFileSync(join(verifier, 'hello.txt'), 'utf8'), 'crew ok\n')
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('execution seats get a local env copy, a dependency link and a port hint', () => {
  const sourceRepo = repo()
  writeFileSync(join(sourceRepo, '.gitignore'), '.env\nnode_modules/\n')
  execFileSync('git', ['add', '.gitignore'], { cwd: sourceRepo })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'ignore'], { cwd: sourceRepo })
  writeFileSync(join(sourceRepo, '.env'), 'TOKEN=ok\n')
  mkdirSync(join(sourceRepo, 'node_modules'))
  writeFileSync(join(sourceRepo, 'node_modules', 'x.js'), 'module.exports=1\n')
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-env-'))
  const previousRoot = process.env.CREW_WORKTREE_ROOT
  const previousMin = process.env.CREW_DISK_MIN_FREE_MB
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  process.env.CREW_DISK_MIN_FREE_MB = '0'
  let workspaces = null
  try {
    workspaces = prepareRoom({ source: sourceRepo, short: 'env123', seats: seatsFor('delivery-triad') })
    const executor = workspaces.seats.executor.path
    const verifier = workspaces.seats.verifier.path
    const planner = workspaces.seats.planner.path
    assert.equal(readFileSync(join(executor, '.env'), 'utf8'), 'TOKEN=ok\n')
    assert.equal(readFileSync(join(verifier, '.env'), 'utf8'), 'TOKEN=ok\n')
    assert.equal(existsSync(join(planner, '.env')), false)
    assert.equal(lstatSync(join(executor, 'node_modules')).isSymbolicLink(), true)
    assert.equal(lstatSync(join(verifier, 'node_modules')).isSymbolicLink(), true)
    assert.equal(new Set(Object.values(workspaces.ports)).size, Object.values(workspaces.ports).length)
    writeFileSync(join(executor, 'hello.txt'), 'crew ok\n')
    const candidate = submit({ path: executor, turnId: 'env-turn', name: 'Env' })
    assert.equal(typeof candidate, 'string')
    const committed = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: executor, encoding: 'utf8' })
    assert.match(committed, /hello\.txt/)
    assert.doesNotMatch(committed, /\.env|node_modules/)
    assert.doesNotMatch(committed, /\.lodge\//)
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previousRoot === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previousRoot
    if (previousMin === undefined) delete process.env.CREW_DISK_MIN_FREE_MB
    else process.env.CREW_DISK_MIN_FREE_MB = previousMin
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('pruning keeps the delivery worktree and candidate branches', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-prune-'))
  const previousRoot = process.env.CREW_WORKTREE_ROOT
  const previousMin = process.env.CREW_DISK_MIN_FREE_MB
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  process.env.CREW_DISK_MIN_FREE_MB = '0'
  let workspaces = null
  try {
    const seats = rosterFromRoles([
      { role: 'lead', name: '队长' },
      { role: 'worker', name: '前端' },
      { role: 'worker', name: '后端' },
      { role: 'verifier', name: '复核' },
    ])
    workspaces = prepareRoom({ source: sourceRepo, short: 'prune1', seats })
    const room = {
      repoPath: workspaces.integration.path,
      sourceRepo,
      worktrees: Object.fromEntries(Object.entries(workspaces.seats).map(([id, item]) => [id, item.path])),
      prunedSeats: [],
    }
    const pruned = pruneSeats(room).sort()
    assert.deepEqual(pruned, ['lead', 'verifier', 'worker', 'worker-2'])
    assert.equal(existsSync(workspaces.integration.path), true)
    assert.equal(existsSync(workspaces.seats.worker.path), false)
    assert.equal(existsSync(workspaces.seats['worker-2'].path), false)
    const branches = execFileSync('git', ['branch', '--list', 'crew/prune1/*'], { cwd: sourceRepo, encoding: 'utf8' })
    assert.match(branches, /worker/)
    assert.match(branches, /worker-2/)
    assert.match(branches, /integration/)
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previousRoot === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previousRoot
    if (previousMin === undefined) delete process.env.CREW_DISK_MIN_FREE_MB
    else process.env.CREW_DISK_MIN_FREE_MB = previousMin
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('parallel workers merge into an integration worktree and conflicts stay visible', async () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-parallel-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    const seats = rosterFromRoles([
      { role: 'worker', name: '前端' },
      { role: 'worker', name: '后端' },
      { role: 'verifier' },
    ])
    workspaces = prepareRoom({ source: sourceRepo, short: 'par123', seats })
    assert.equal(workspaces.primaryBranch, 'crew/par123/integration')
    assert.equal(workspaces.roomPath, workspaces.integration.path)
    const front = workspaces.seats.worker.path
    const back = workspaces.seats['worker-2'].path
    assert.notEqual(front, back)
    assert.equal(existsSync(workspaces.integration.path), true)

    const base = head({ path: workspaces.roomPath })
    writeFileSync(join(front, 'front.txt'), 'front\n')
    writeFileSync(join(back, 'back.txt'), 'back\n')
    assert.equal(typeof submit({ path: front, turnId: 't1', name: 'Room' }), 'string')
    assert.equal(typeof submit({ path: back, turnId: 't2', name: 'Room' }), 'string')

    const first = integrate({ path: workspaces.integration.path, branch: workspaces.branches.worker })
    assert.equal(first.ok, true, first.error)
    const second = integrate({ path: workspaces.integration.path, branch: workspaces.branches['worker-2'] })
    assert.equal(second.ok, true, second.error)
    assert.equal(existsSync(join(workspaces.integration.path, 'front.txt')), true)
    assert.equal(existsSync(join(workspaces.integration.path, 'back.txt')), true)
    const range = await rangeChanges({ path: workspaces.integration.path, base })
    assert.deepEqual([...range.files].sort(), ['back.txt', 'front.txt'])

    writeFileSync(join(front, 'same.txt'), 'front wins\n')
    writeFileSync(join(back, 'same.txt'), 'back wins\n')
    submit({ path: front, turnId: 't3', name: 'Room' })
    submit({ path: back, turnId: 't4', name: 'Room' })
    const third = integrate({ path: workspaces.integration.path, branch: workspaces.branches.worker })
    assert.equal(third.ok, true, third.error)
    const conflict = integrate({ path: workspaces.integration.path, branch: workspaces.branches['worker-2'] })
    assert.equal(conflict.ok, false)
    assert.deepEqual(conflict.files, ['same.txt'])
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspaces.integration.path, encoding: 'utf8' }).trim()
    assert.equal(status, '')
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})
