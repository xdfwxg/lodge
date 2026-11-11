import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  changes, cleanupRoom, head, integrate, isolatedCopy, persistRoom, prepareRoom, pruneSeats, removeIsolatedCopy,
} from './workspace-plain.js'

const temp = prefix => mkdtempSync(join(tmpdir(), prefix))

const sourceDir = () => {
  const root = temp('lodge-plain-src-')
  writeFileSync(join(root, 'README.md'), '# demo\n')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.txt'), 'one\n')
  writeFileSync(join(root, '.env'), 'TOKEN=local\n')
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  mkdirSync(join(root, 'node_modules'))
  return root
}

const withRoot = fn => {
  const previous = process.env.CREW_COPY_ROOT
  const root = temp('lodge-plain-copies-')
  process.env.CREW_COPY_ROOT = root
  try {
    return fn(root)
  } finally {
    if (previous === undefined) delete process.env.CREW_COPY_ROOT
    else process.env.CREW_COPY_ROOT = previous
    rmSync(root, { recursive: true, force: true })
  }
}

test('plain workspaces copy content without git or local-only files', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({ source, short: 'plain1', seats: [{ id: 'executor', role: 'worker' }] })
    const seat = workspaces.seats.executor.path
    assert.equal(readFileSync(join(seat, 'README.md'), 'utf8'), '# demo\n')
    assert.equal(readFileSync(join(seat, '.env'), 'utf8'), 'TOKEN=local\n')
    assert.equal(existsSync(join(seat, '.git')), false)
    assert.equal(existsSync(join(seat, 'node_modules')), true)
    assert.equal(workspaces.roomPath, seat)
    assert.deepEqual(workspaces.branches, {})
    cleanupRoom({ source, workspaces })
    assert.equal(existsSync(seat), false)
  })
  rmSync(source, { recursive: true, force: true })
})

test('plain evidence is a file manifest, not a diff', async () => {
  const source = sourceDir()
  const previous = process.env.CREW_COPY_ROOT
  const root = temp('lodge-plain-copies-')
  process.env.CREW_COPY_ROOT = root
  try {
    const workspaces = prepareRoom({ source, short: 'plain2', seats: [{ id: 'executor', role: 'worker' }] })
    const seat = workspaces.seats.executor.path
    const result = await changes({ path: seat })
    assert.equal(result.diff, '')
    assert.deepEqual(result.files.sort(), ['README.md', 'src/a.txt'])
    assert.match(result.note, /文件清单/)
    assert.equal(typeof head({ path: seat }), 'string')
    cleanupRoom({ source, workspaces })
  } finally {
    if (previous === undefined) delete process.env.CREW_COPY_ROOT
    else process.env.CREW_COPY_ROOT = previous
    rmSync(root, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})

test('plain integration copies files and reports same-path conflicts', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({
      source,
      short: 'plain3',
      seats: [{ id: 'worker', role: 'worker' }, { id: 'worker-2', role: 'worker' }],
    })
    const first = workspaces.seats.worker.path
    const second = workspaces.seats['worker-2'].path
    const integration = workspaces.integration.path
    writeFileSync(join(first, 'src', 'a.txt'), 'from-first\n')
    assert.deepEqual(integrate({ path: integration, source: first }), { ok: true })
    assert.equal(readFileSync(join(integration, 'src', 'a.txt'), 'utf8'), 'from-first\n')

    writeFileSync(join(second, 'src', 'a.txt'), 'from-second\n')
    const conflict = integrate({ path: integration, source: second })
    assert.equal(conflict.ok, false)
    assert.deepEqual(conflict.files, ['src/a.txt'])
    assert.equal(readFileSync(join(integration, 'src', 'a.txt'), 'utf8'), 'from-first\n')
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})

test('plain acceptance copies are disposable and do not need a commit', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({ source, short: 'plain4', seats: [{ id: 'executor', role: 'worker' }] })
    const copy = isolatedCopy({ source: workspaces.roomPath })
    writeFileSync(join(copy.path, 'side-effect.txt'), 'discard\n')
    assert.equal(existsSync(join(workspaces.roomPath, 'side-effect.txt')), false)
    removeIsolatedCopy({ copy })
    assert.equal(existsSync(copy.path), false)
    assert.equal(persistRoom({ room: {}, files: [] }), true)
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})

test('pruning keeps the delivery copy and removes other seats', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({
      source,
      short: 'plain5',
      seats: [{ id: 'worker', role: 'worker' }, { id: 'verifier', role: 'verifier' }],
    })
    const room = {
      repoPath: workspaces.roomPath,
      worktrees: { worker: workspaces.seats.worker.path, verifier: workspaces.seats.verifier.path },
    }
    const pruned = pruneSeats(room)
    assert.deepEqual(pruned, ['verifier'])
    assert.equal(existsSync(workspaces.seats.worker.path), true)
    assert.equal(existsSync(workspaces.seats.verifier.path), false)
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})
