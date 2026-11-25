import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { foreignReadsOf } from './read-boundary.js'

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-read-boundary-'))
  const repo = join(root, 'repo')
  const worker = join(root, 'worker')
  const verifier = join(root, 'verifier')
  for (const path of [repo, worker, verifier]) mkdirSync(path, { recursive: true })
  const room = {
    repoPath: repo,
    sourceRepo: join(root, 'source'),
    worktrees: { worker, verifier },
  }
  return { root, room, close: () => rmSync(root, { recursive: true, force: true }) }
}

test('reading or running inside another copy is a foreign read', () => {
  const ctx = setup()
  try {
    const calls = [
      { name: 'Read', input: { file_path: join(ctx.room.worktrees.worker, 'README.md') } },
      { name: 'Bash', input: { command: `cd ${join(ctx.room.repoPath, 'src')} && npm test` } },
    ]
    const hits = foreignReadsOf({ calls, room: ctx.room, memberId: 'verifier' })
    assert.deepEqual(hits.map(hit => hit.root).sort(), ['worker', '集成目录'].sort())
  } finally {
    ctx.close()
  }
})

test('reads inside the verifier copy and relative commands are allowed', () => {
  const ctx = setup()
  try {
    const calls = [
      { name: 'Read', input: { file_path: join(ctx.room.worktrees.verifier, 'README.md') } },
      { name: 'Read', step: { target: 'src/a.js' } },
      { name: 'Bash', input: { command: 'npm test' } },
      { name: 'Bash', step: { detail: 'cd src && node --test' } },
    ]
    assert.deepEqual(foreignReadsOf({ calls, room: ctx.room, memberId: 'verifier' }), [])
  } finally {
    ctx.close()
  }
})

test('write and gate tools are not counted as evidence reads', () => {
  const ctx = setup()
  try {
    const calls = [
      { name: 'Edit', input: { file_path: join(ctx.room.worktrees.worker, 'README.md') } },
      { name: 'mcp__lodge_gate__submit_verdict', input: { command: join(ctx.room.repoPath, 'x') } },
    ]
    assert.deepEqual(foreignReadsOf({ calls, room: ctx.room, memberId: 'verifier' }), [])
  } finally {
    ctx.close()
  }
})

test('a room without a verifier copy falls back to the room path as its own', () => {
  const ctx = setup()
  try {
    const room = { ...ctx.room, worktrees: { worker: ctx.room.worktrees.worker } }
    const calls = [{ name: 'Read', input: { file_path: join(ctx.room.repoPath, 'README.md') } }]
    assert.deepEqual(foreignReadsOf({ calls, room, memberId: 'verifier' }), [])
  } finally {
    ctx.close()
  }
})
