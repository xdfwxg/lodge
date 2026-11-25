import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  addMember, changedFilesSince, changes, cleanupRoom, commitMessageOf, filesInCommit, head, integrate, prepareRoom, pruneRewindBranches, pruneMembers, rangeChanges,
  refreshReviewCopy, removeMember, resetMemberWorktree, restore, submit,
} from './workspace-git.js'
import { rosterFromRoles, membersFor } from './roster.js'

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-worktree-src-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

test('a candidate commit lists files written by shell commands', () => {
  const sourceRepo = repo()
  try {
    const base = head({ path: sourceRepo })
    writeFileSync(join(sourceRepo, 'icon-2x.png'), 'png\n')
    execFileSync('git', ['add', '.'], { cwd: sourceRepo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'export icons'], { cwd: sourceRepo })
    const commit = head({ path: sourceRepo })
    assert.deepEqual(filesInCommit({ path: sourceRepo, commit }), ['icon-2x.png'])
    assert.deepEqual(changedFilesSince({ path: sourceRepo, base }), ['icon-2x.png'])
  } finally {
    rmSync(sourceRepo, { recursive: true, force: true })
  }
})

test('file lists keep Chinese names readable instead of git-quoted escapes', async () => {
  const sourceRepo = repo()
  const name = 'unique-执行官.txt'
  try {
    writeFileSync(join(sourceRepo, name), 'done\n')
    const working = await changes({ path: sourceRepo })
    assert.ok(working.files.includes(name), `unexpected files: ${JSON.stringify(working.files)}`)
    execFileSync('git', ['add', '.'], { cwd: sourceRepo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'add chinese file'], { cwd: sourceRepo })
    const ranged = await rangeChanges({ path: sourceRepo, base: `${head({ path: sourceRepo })}~1` })
    assert.deepEqual(ranged.files, [name])
  } finally {
    rmSync(sourceRepo, { recursive: true, force: true })
  }
})

test('a low disk watermark stops preparation before worktrees are left behind', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-disk-'))
  const previousRoot = process.env.CREW_WORKTREE_ROOT
  const previousMin = process.env.CREW_DISK_MIN_FREE_MB
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  process.env.CREW_DISK_MIN_FREE_MB = '999999999'
  try {
    assert.throws(
      () => prepareRoom({ source: sourceRepo, short: 'disk1', members: membersFor('delivery-triad') }),
      /磁盘可用空间不足/,
    )
    assert.equal(existsSync(join(worktreeRoot, 'disk1')), false)
  } finally {
    if (previousRoot === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previousRoot
    if (previousMin === undefined) delete process.env.CREW_DISK_MIN_FREE_MB
    else process.env.CREW_DISK_MIN_FREE_MB = previousMin
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('read-only copies never receive tracked env secrets', () => {
  const sourceRepo = repo()
  writeFileSync(join(sourceRepo, '.env'), 'TOKEN=secret\n')
  writeFileSync(join(sourceRepo, '.env.example'), 'TOKEN=\n')
  execFileSync('git', ['add', '.env', '.env.example'], { cwd: sourceRepo })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'env'], { cwd: sourceRepo })
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-worktrees-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    workspaces = prepareRoom({ source: sourceRepo, short: 'env1234', members: membersFor('delivery-triad') })
    const executor = workspaces.members.executor.path
    const verifier = workspaces.members.verifier.path
    const planner = workspaces.members.planner.path
    assert.equal(existsSync(join(executor, '.env')), true)
    assert.equal(existsSync(join(verifier, '.env')), false)
    assert.equal(existsSync(join(verifier, '.env.example')), true)
    assert.equal(existsSync(join(planner, '.env')), false)
    assert.equal(existsSync(join(planner, '.env.example')), true)
    refreshReviewCopy({ path: verifier, branch: workspaces.branches.executor })
    assert.equal(existsSync(join(verifier, '.env')), false)
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('a member worktree resets to the stage base before a rework', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-worktrees-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    workspaces = prepareRoom({ source: sourceRepo, short: 'reset12', members: membersFor('delivery-triad') })
    const executor = workspaces.members.executor.path
    const base = head({ path: sourceRepo })
    writeFileSync(join(executor, 'draft.txt'), 'old\n')
    assert.equal(typeof submit({ path: executor, turnId: 't1', name: 'Room' }), 'string')
    writeFileSync(join(executor, 'leftover.txt'), 'junk\n')
    assert.equal(resetMemberWorktree({ path: executor, ref: base, source: sourceRepo }), true)
    assert.equal(head({ path: executor }), base)
    assert.equal(existsSync(join(executor, 'draft.txt')), false)
    assert.equal(existsSync(join(executor, 'leftover.txt')), false)
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('prepares isolated member workspaces and refreshes the verifier copy', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-worktrees-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    workspaces = prepareRoom({ source: sourceRepo, short: 'abc123', members: membersFor('delivery-triad') })
    const executor = workspaces.members.executor.path
    const verifier = workspaces.members.verifier.path
    assert.equal(existsSync(executor), true)
    assert.equal(existsSync(workspaces.members.planner.path), true)
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

test('a probe patch committed into the review copy is what git shows as HEAD', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-worktrees-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  let workspaces = null
  try {
    workspaces = prepareRoom({ source: sourceRepo, short: 'probe123', members: membersFor('delivery-triad') })
    const verifier = workspaces.members.verifier.path
    const executor = workspaces.members.executor.path
    writeFileSync(join(executor, 'README.md'), '# delivered\n')
    submit({ path: executor, turnId: 't1', name: 'Room' })
    refreshReviewCopy({ path: verifier, branch: workspaces.branches.executor })
    // 探针补丁写成复核副本里的未提交改动，验收员再开一份干净副本就看不到缺陷。
    writeFileSync(join(verifier, 'README.md'), '# defective\n')
    const commit = submit({ path: verifier, turnId: 'probe-0', name: 'review patch' })
    assert.equal(typeof commit, 'string')
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: verifier, encoding: 'utf8' }).trim(), '')
    assert.equal(execFileSync('git', ['show', `${commit}:README.md`], { cwd: verifier, encoding: 'utf8' }), '# defective\n')
    assert.equal(readFileSync(join(verifier, 'README.md'), 'utf8'), '# defective\n')
  } finally {
    if (workspaces !== null) cleanupRoom({ source: sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('a removed member can be added again without a stale branch', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-readd-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  try {
    const workspaces = prepareRoom({ source: sourceRepo, short: 'readd1', members: membersFor('delivery-triad') })
    const member = { ...membersFor('delivery-triad').find(item => item.id === 'executor'), id: 'worker-2' }
    const baseRoom = {
      id: 'room-readd1',
      sourceRepo,
      branches: { ...workspaces.branches },
      worktrees: Object.fromEntries(Object.entries(workspaces.members).map(([id, item]) => [id, item.path])),
      ports: { ...workspaces.ports },
    }
    const first = addMember({ room: baseRoom, member })
    const room = {
      ...baseRoom,
      branches: { ...baseRoom.branches, 'worker-2': first.branch },
      worktrees: { ...baseRoom.worktrees, 'worker-2': first.path },
    }
    removeMember({ room, member })
    const again = addMember({ room, member })
    assert.equal(existsSync(again.path), true)
  } finally {
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('execution members get env and dependencies without sharing the source tree', () => {
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
    workspaces = prepareRoom({ source: sourceRepo, short: 'env123', members: membersFor('delivery-triad') })
    const executor = workspaces.members.executor.path
    const verifier = workspaces.members.verifier.path
    const planner = workspaces.members.planner.path
    assert.equal(readFileSync(join(executor, '.env'), 'utf8'), 'TOKEN=ok\n')
    assert.equal(existsSync(join(verifier, '.env')), false)
    assert.equal(existsSync(join(planner, '.env')), false)
    assert.equal(lstatSync(join(executor, 'node_modules')).isSymbolicLink(), false)
    assert.equal(lstatSync(join(verifier, 'node_modules')).isSymbolicLink(), false)
    writeFileSync(join(executor, 'node_modules', 'x.js'), 'module.exports=2\n')
    assert.equal(readFileSync(join(sourceRepo, 'node_modules', 'x.js'), 'utf8'), 'module.exports=1\n')
    assert.equal(new Set(Object.values(workspaces.ports)).size, Object.values(workspaces.ports).length)
    assert.doesNotMatch(execFileSync('git', ['status', '--porcelain'], { cwd: executor, encoding: 'utf8' }), /\.lodge/)
    execFileSync('git', ['add', '-A'], { cwd: executor })
    assert.doesNotMatch(
      execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: executor, encoding: 'utf8' }),
      /\.lodge|\.crew/,
    )
    execFileSync('git', ['reset', '-q'], { cwd: executor })
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

test('restore rewinds the room to a stage base and keeps a backup branch', () => {
  const sourceRepo = repo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-rewind-'))
  const previousRoot = process.env.CREW_WORKTREE_ROOT
  const previousMin = process.env.CREW_DISK_MIN_FREE_MB
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  process.env.CREW_DISK_MIN_FREE_MB = '0'
  let workspaces = null
  try {
    const members = rosterFromRoles([
      { role: 'lead', name: '队长' },
      { role: 'worker', name: '甲' },
      { role: 'verifier', name: '复核' },
    ])
    workspaces = prepareRoom({ source: sourceRepo, short: 'rew1', members })
    const worker = workspaces.members.worker.path
    const room = {
      id: 'room-rew1',
      repoPath: workspaces.roomPath,
      workers: ['worker'],
      worktrees: Object.fromEntries(Object.entries(workspaces.members).map(([id, item]) => [id, item.path])),
      workspace: { provider: 'git' },
    }
    const base = head({ path: worker })
    writeFileSync(join(worker, 'stage1.txt'), 'one\n')
    const candidate = submit({ path: worker, turnId: 't1', name: 'Room' })
    assert.equal(typeof candidate, 'string')

    writeFileSync(join(worker, 'README.md'), 'dirty\n')
    assert.throws(() => restore({ room, base }), /没保存的改动/)
    execFileSync('git', ['checkout', '--', 'README.md'], { cwd: worker })

    const result = restore({ room, base })
    assert.equal(result.base, base)
    assert.equal(head({ path: worker }), base)
    assert.equal(existsSync(join(worker, 'stage1.txt')), false)
    assert.equal(result.backups.length, 1)
    const backed = execFileSync('git', ['rev-parse', result.backups[0]], { cwd: sourceRepo, encoding: 'utf8' }).trim()
    assert.equal(backed, candidate)
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

test('only old rewind backup branches are pruned', () => {
  const sourceRepo = repo()
  try {
    const base = head({ path: sourceRepo })
    execFileSync('git', ['branch', 'rewind/abc/room/1000', base], { cwd: sourceRepo })
    const fresh = Date.now()
    execFileSync('git', ['branch', `rewind/abc/worker/${fresh}`, base], { cwd: sourceRepo })
    execFileSync('git', ['branch', 'rewind/abc/malformed', base], { cwd: sourceRepo })
    execFileSync('git', ['branch', 'keep/abc', base], { cwd: sourceRepo })
    const removed = pruneRewindBranches({ path: sourceRepo, ttlMs: 7 * 24 * 60 * 60 * 1000, now: fresh })
    assert.equal(removed, 1)
    const branches = execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: sourceRepo, encoding: 'utf8' })
    assert.doesNotMatch(branches, /rewind\/abc\/room\/1000/)
    assert.match(branches, new RegExp(`rewind/abc/worker/${fresh}`))
    assert.match(branches, /rewind\/abc\/malformed/)
    assert.match(branches, /keep\/abc/)
  } finally {
    rmSync(sourceRepo, { recursive: true, force: true })
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
    const members = rosterFromRoles([
      { role: 'lead', name: '队长' },
      { role: 'worker', name: '前端' },
      { role: 'worker', name: '后端' },
      { role: 'verifier', name: '复核' },
    ])
    workspaces = prepareRoom({ source: sourceRepo, short: 'prune1', members })
    const room = {
      repoPath: workspaces.integration.path,
      sourceRepo,
      worktrees: Object.fromEntries(Object.entries(workspaces.members).map(([id, item]) => [id, item.path])),
      prunedMembers: [],
    }
    const pruned = pruneMembers(room).sort()
    assert.deepEqual(pruned, ['lead', 'verifier', 'worker', 'worker-2'])
    assert.equal(existsSync(workspaces.integration.path), true)
    assert.equal(existsSync(workspaces.members.worker.path), false)
    assert.equal(existsSync(workspaces.members['worker-2'].path), false)
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
    const members = rosterFromRoles([
      { role: 'worker', name: '前端' },
      { role: 'worker', name: '后端' },
      { role: 'verifier' },
    ])
    workspaces = prepareRoom({ source: sourceRepo, short: 'par123', members })
    assert.equal(workspaces.primaryBranch, 'crew/par123/integration')
    assert.equal(workspaces.roomPath, workspaces.integration.path)
    const front = workspaces.members.worker.path
    const back = workspaces.members['worker-2'].path
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
    const kept = integrate({ path: workspaces.integration.path, branch: workspaces.branches['worker-2'], keepConflict: true })
    assert.equal(kept.ok, false)
    assert.match(kept.versions[0].ours, /front wins/)
    assert.match(kept.versions[0].theirs, /back wins/)
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspaces.integration.path, encoding: 'utf8' }).trim()
    assert.match(status, /^(UU|AA) same\.txt$/m)
  } finally {
    cleanupRoom({ source: sourceRepo, workspaces })
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test('pruning never deletes outside the workspace root', () => {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'crew-prune-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'crew-outside-'))
  const previousRoot = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = worktreeRoot
  try {
    writeFileSync(join(outside, 'keep.txt'), 'keep\n')
    const pruned = pruneMembers({ worktrees: { worker: outside }, prunedMembers: [] })
    assert.deepEqual(pruned, [])
    assert.equal(existsSync(join(outside, 'keep.txt')), true)
  } finally {
    if (previousRoot === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previousRoot
    rmSync(worktreeRoot, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('the room commit names what changed instead of repeating the goal', () => {
  const message = commitMessageOf({ room: { name: '写一个 slugify 工具' }, files: ['/tmp/room/slugify.js', '/tmp/room/slugify.test.js'] })
  assert.equal(message, 'room: 更新 slugify.js、slugify.test.js')
  assert.equal(commitMessageOf({ room: { name: '写一个 slugify 工具' }, files: [] }), 'room: 写一个 slugify 工具')
  assert.equal(
    commitMessageOf({ room: { name: '目标' }, files: ['a', 'b', 'c', 'd', 'e'] }),
    'room: 更新 a、b、c、d 等 5 个文件',
  )
})

test('renames, binaries, CRLF and large files keep their file list', async () => {
  const sourceRepo = repo()
  try {
    const base = head({ path: sourceRepo })
    execFileSync('git', ['mv', 'README.md', 'GUIDE.md'], { cwd: sourceRepo })
    writeFileSync(join(sourceRepo, 'image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]))
    writeFileSync(join(sourceRepo, 'crlf.txt'), 'a\r\nb\r\n')
    writeFileSync(join(sourceRepo, 'no-newline.txt'), 'tail')
    writeFileSync(join(sourceRepo, 'big.txt'), 'x'.repeat(2 * 1024 * 1024))

    const dirty = await changes({ path: sourceRepo })
    for (const file of ['GUIDE.md', 'image.bin', 'crlf.txt', 'no-newline.txt', 'big.txt']) {
      assert.ok(dirty.files.includes(file), `${file} 没进工作区文件清单：${dirty.files.join(',')}`)
    }
    assert.ok(dirty.diff.length <= 64 * 1024 + 40)
    assert.match(dirty.diff, /输出已截断/)

    execFileSync('git', ['add', '-A'], { cwd: sourceRepo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'edge files'], { cwd: sourceRepo })
    const commit = head({ path: sourceRepo })

    const range = await rangeChanges({ path: sourceRepo, base })
    for (const file of ['GUIDE.md', 'image.bin', 'crlf.txt', 'no-newline.txt', 'big.txt']) {
      assert.ok(range.files.includes(file), `${file} 没进阶段 diff：${range.files.join(',')}`)
    }
    assert.ok(range.diff.length <= 64 * 1024 + 40)
    assert.match(range.diff, /输出已截断/)

    const committed = filesInCommit({ path: sourceRepo, commit })
    for (const file of ['GUIDE.md', 'image.bin', 'crlf.txt', 'no-newline.txt', 'big.txt']) {
      assert.ok(committed.includes(file), `${file} 没进提交清单：${committed.join(',')}`)
    }
    assert.ok(changedFilesSince({ path: sourceRepo, base }).includes('big.txt'))
  } finally {
    rmSync(sourceRepo, { recursive: true, force: true })
  }
})

test('a local submodule is reported as a gitlink, not followed into its files', async () => {
  const sourceRepo = repo()
  const subRepo = repo()
  try {
    execFileSync('git', [
      '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subRepo, 'vendor/thing',
    ], { cwd: sourceRepo })
    const dirty = await changes({ path: sourceRepo })
    assert.ok(dirty.files.includes('.gitmodules'), dirty.files.join(','))
    assert.ok(dirty.files.includes('vendor/thing'), dirty.files.join(','))

    execFileSync('git', ['add', '-A'], { cwd: sourceRepo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'add submodule'], { cwd: sourceRepo })
    const committed = filesInCommit({ path: sourceRepo, commit: head({ path: sourceRepo }) })
    assert.ok(committed.includes('vendor/thing'), committed.join(','))
    assert.ok(!committed.some(file => file.startsWith('vendor/thing/')), committed.join(','))
  } finally {
    rmSync(sourceRepo, { recursive: true, force: true })
    rmSync(subRepo, { recursive: true, force: true })
  }
})
