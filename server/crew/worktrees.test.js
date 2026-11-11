import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { cleanupWorkspaces, commitCandidate, headOf, mergeBranch, prepareWorkspaces, refreshVerifier } from './worktrees.js'
import { collectRange } from './acceptance.js'
import { rosterFromRoles, seatsFor } from './seats.js'

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-worktree-src-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

test('prepares isolated seat workspaces and refreshes the verifier copy', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-worktrees-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    workspaces = prepareWorkspaces({ sourceRepo, short: 'abc123', seats: seatsFor('delivery-triad') })
    const executor = workspaces.seats.executor.path
    const verifier = workspaces.seats.verifier.path
    assert.equal(existsSync(executor), true)
    assert.equal(existsSync(workspaces.seats.planner.path), true)
    assert.equal(existsSync(verifier), true)

    writeFileSync(join(executor, 'hello.txt'), 'crew ok\n')
    const commit = commitCandidate({ executor, turnId: 't1', name: 'Room' })
    assert.equal(typeof commit, 'string')
    refreshVerifier({ verifier, branch: workspaces.branches.executor })
    assert.equal(readFileSync(join(verifier, 'hello.txt'), 'utf8'), readFileSync(join(executor, 'hello.txt'), 'utf8'))

    writeFileSync(join(verifier, 'scratch.txt'), 'discard me\n')
    refreshVerifier({ verifier, branch: workspaces.branches.executor })
    assert.equal(existsSync(join(verifier, 'scratch.txt')), false)
    assert.equal(readFileSync(join(verifier, 'hello.txt'), 'utf8'), 'crew ok\n')
  } finally {
    cleanupWorkspaces({ sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
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
    workspaces = prepareWorkspaces({ sourceRepo, short: 'par123', seats })
    assert.equal(workspaces.primaryBranch, 'crew/par123/integration')
    assert.equal(workspaces.roomPath, workspaces.integration.path)
    const front = workspaces.seats.worker.path
    const back = workspaces.seats['worker-2'].path
    assert.notEqual(front, back)
    assert.equal(existsSync(workspaces.integration.path), true)

    const base = headOf(workspaces.roomPath)
    writeFileSync(join(front, 'front.txt'), 'front\n')
    writeFileSync(join(back, 'back.txt'), 'back\n')
    assert.equal(typeof commitCandidate({ executor: front, turnId: 't1', name: 'Room' }), 'string')
    assert.equal(typeof commitCandidate({ executor: back, turnId: 't2', name: 'Room' }), 'string')

    assert.equal(mergeBranch({ worktree: workspaces.integration.path, branch: workspaces.branches.worker }).ok, true)
    assert.equal(mergeBranch({ worktree: workspaces.integration.path, branch: workspaces.branches['worker-2'] }).ok, true)
    assert.equal(existsSync(join(workspaces.integration.path, 'front.txt')), true)
    assert.equal(existsSync(join(workspaces.integration.path, 'back.txt')), true)
    const range = await collectRange({ cwd: workspaces.integration.path, base })
    assert.deepEqual([...range.files].sort(), ['back.txt', 'front.txt'])

    writeFileSync(join(front, 'same.txt'), 'front wins\n')
    writeFileSync(join(back, 'same.txt'), 'back wins\n')
    commitCandidate({ executor: front, turnId: 't3', name: 'Room' })
    commitCandidate({ executor: back, turnId: 't4', name: 'Room' })
    assert.equal(mergeBranch({ worktree: workspaces.integration.path, branch: workspaces.branches.worker }).ok, true)
    const conflict = mergeBranch({ worktree: workspaces.integration.path, branch: workspaces.branches['worker-2'] })
    assert.equal(conflict.ok, false)
    assert.deepEqual(conflict.files, ['same.txt'])
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspaces.integration.path, encoding: 'utf8' }).trim()
    assert.equal(status, '')
  } finally {
    cleanupWorkspaces({ sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})
