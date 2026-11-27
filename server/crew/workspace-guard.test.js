import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { beginWriteGuard, guardTurn, isReadOnlyRole, resetWriteGuard, unreturnedReadOnlyViolations } from './workspace-guard.js'
import { revertPaths } from './workspace-git.js'

const git = (cwd, args) => execFileSync('git', [
  '-c', 'user.name=Lodge',
  '-c', 'user.email=lodge@example.com',
  ...args,
], { cwd, stdio: 'ignore' })

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-guard-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git(repo, ['add', 'README.md'])
  git(repo, ['commit', '-qm', 'first'])
  const a = join(root, 'a')
  const b = join(root, 'b')
  git(repo, ['worktree', 'add', '-q', '-b', 'a', a, 'HEAD'])
  git(repo, ['worktree', 'add', '-q', '-b', 'b', b, 'HEAD'])
  const room = {
    id: `room-${Math.random()}`,
    workspace: { provider: 'git' },
    worktrees: { a, b },
  }
  return { root, a, b, room, close: () => { resetWriteGuard(room.id); rmSync(root, { recursive: true, force: true }) } }
}

test('a write into another member’s worktree is reverted', () => {
  const ctx = setup()
  try {
    beginWriteGuard(ctx.room)
    writeFileSync(join(ctx.b, 'stray.txt'), 'not mine\n')
    const violations = guardTurn(ctx.room, 'a')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].memberId, 'b')
    assert.equal(violations[0].reverted, true)
    assert.equal(existsSync(join(ctx.b, 'stray.txt')), false)
    assert.equal(existsSync(join(ctx.b, 'README.md')), true)
  } finally {
    ctx.close()
  }
})

test('the acting member keeps its own changes', () => {
  const ctx = setup()
  try {
    beginWriteGuard(ctx.room)
    writeFileSync(join(ctx.a, 'mine.txt'), 'ok\n')
    assert.deepEqual(guardTurn(ctx.room, 'a'), [])
    assert.equal(readFileSync(join(ctx.a, 'mine.txt'), 'utf8'), 'ok\n')
  } finally {
    ctx.close()
  }
})

test('with a parallel dispatch the guard does not blame the acting member for a teammate’s work', () => {
  // 真房：两个执行官并行，队友正常写自己的副本，先收工的那位被说成“改到了”队友的工作副本。
  const ctx = setup()
  try {
    beginWriteGuard(ctx.room)
    writeFileSync(join(ctx.b, 'teammate.txt'), 'b is working\n')
    assert.deepEqual(guardTurn(ctx.room, 'a', { others: false }), [])
    // 关掉跨人对账之后，队友的下一笔改动仍然按正常路径算数（不是永久免疫）。
    writeFileSync(join(ctx.b, 'teammate-2.txt'), 'b again\n')
    assert.equal(guardTurn(ctx.room, 'a').length, 1)
  } finally {
    ctx.close()
  }
})

test('planner and verifier worktrees are reverted even when they are acting', () => {
  const ctx = setup()
  ctx.room.members = [
    { id: 'a', role: 'lead', roleKind: 'planner' },
    { id: 'b', role: 'verifier', roleKind: 'verifier' },
  ]
  try {
    beginWriteGuard(ctx.room)
    writeFileSync(join(ctx.a, 'planner-draft.txt'), 'not a delivery\n')
    writeFileSync(join(ctx.b, 'verifier-draft.txt'), 'not evidence\n')
    const violations = guardTurn(ctx.room, 'a')
    assert.deepEqual(violations.map(item => item.memberId).sort(), ['a', 'b'])
    assert.ok(violations.every(item => item.reverted === true))
    assert.equal(existsSync(join(ctx.a, 'planner-draft.txt')), false)
    assert.equal(existsSync(join(ctx.b, 'verifier-draft.txt')), false)
  } finally {
    ctx.close()
  }
})

test('a platform checkout of a review copy is not counted as a member write', () => {
  const ctx = setup()
  try {
    beginWriteGuard(ctx.room)
    // 平台把验收员副本换到候选提交；这不是验收员改的文件。
    writeFileSync(join(ctx.b, 'README.md'), '# candidate\n')
    git(ctx.b, ['commit', '-qam', 'candidate'])
    beginWriteGuard(ctx.room)
    const violations = guardTurn(ctx.room, 'a')
    assert.deepEqual(violations, [])
  } finally {
    ctx.close()
  }
})

test('a worktree that was already dirty is reported, not reverted', () => {
  const ctx = setup()
  try {
    writeFileSync(join(ctx.b, 'README.md'), '# repo changed\n')
    beginWriteGuard(ctx.room)
    writeFileSync(join(ctx.b, 'stray.txt'), 'not mine\n')
    const violations = guardTurn(ctx.room, 'a')
    assert.equal(violations.length, 1)
    assert.equal(violations[0].reverted, false)
    assert.equal(existsSync(join(ctx.b, 'stray.txt')), true)
  } finally {
    ctx.close()
  }
})

test('revertPaths restores tracked files and removes untracked ones without touching the rest', () => {
  const ctx = setup()
  try {
    writeFileSync(join(ctx.a, 'README.md'), '# changed\n')
    writeFileSync(join(ctx.a, 'stray.txt'), 'not mine\n')
    writeFileSync(join(ctx.a, 'keep.txt'), 'mine\n')
    const result = revertPaths({ path: ctx.a, files: ['README.md', 'stray.txt', '../escape.txt'] })
    assert.deepEqual(result.reverted.sort(), ['README.md', 'stray.txt'])
    assert.deepEqual(result.failed, ['../escape.txt'])
    assert.equal(readFileSync(join(ctx.a, 'README.md'), 'utf8'), '# repo\n')
    assert.equal(existsSync(join(ctx.a, 'stray.txt')), false)
    assert.equal(readFileSync(join(ctx.a, 'keep.txt'), 'utf8'), 'mine\n')
  } finally {
    ctx.close()
  }
})

test('only a read-only role with an unreturned foreign write blocks the turn', () => {
  const room = {
    members: [
      { id: 'v', roleKind: 'verifier' },
      { id: 'p', roleKind: 'planner' },
      { id: 'w', roleKind: 'executor' },
    ],
  }
  assert.equal(isReadOnlyRole(room, 'v'), true)
  assert.equal(isReadOnlyRole(room, 'p'), true)
  assert.equal(isReadOnlyRole(room, 'w'), false)
  const violations = [
    { memberId: 'w', reverted: false },
    { memberId: 'x', reverted: true },
    { memberId: 'v', reverted: false },
  ]
  // 别人还没退回去的写会拦停；自己的临时文件、已经退回的都不算。
  assert.deepEqual(
    unreturnedReadOnlyViolations({ room, memberId: 'v', violations }).map(item => item.memberId),
    ['w'],
  )
  assert.deepEqual(unreturnedReadOnlyViolations({ room, memberId: 'w', violations }), [])
})

test('a room without git worktrees has nothing to guard', () => {
  assert.deepEqual(guardTurn({ id: 'room-1', workspace: { provider: 'direct' }, worktrees: {} }, 'a'), [])
  beginWriteGuard({ id: 'room-1', workspace: { provider: 'git' }, worktrees: {} })
})
