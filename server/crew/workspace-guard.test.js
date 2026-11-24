import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { beginWriteGuard, guardTurn, resetWriteGuard } from './workspace-guard.js'

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

test('a room without git worktrees has nothing to guard', () => {
  assert.deepEqual(guardTurn({ id: 'room-1', workspace: { provider: 'direct' }, worktrees: {} }, 'a'), [])
  beginWriteGuard({ id: 'room-1', workspace: { provider: 'git' }, worktrees: {} })
})
