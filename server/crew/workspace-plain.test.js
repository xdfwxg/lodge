import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  changes, cleanupRoom, head, integrate, manifest, persistRoom, prepareRoom, pruneMembers,
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
    const workspaces = prepareRoom({ source, short: 'plain1', members: [{ id: 'executor', role: 'worker' }] })
    const member = workspaces.members.executor.path
    assert.equal(readFileSync(join(member, 'README.md'), 'utf8'), '# demo\n')
    assert.equal(readFileSync(join(member, '.env'), 'utf8'), 'TOKEN=local\n')
    assert.equal(existsSync(join(member, '.git')), false)
    assert.equal(existsSync(join(member, 'node_modules')), true)
    assert.equal(workspaces.roomPath, member)
    assert.deepEqual(workspaces.branches, {})
    cleanupRoom({ source, workspaces })
    assert.equal(existsSync(member), false)
  })
  rmSync(source, { recursive: true, force: true })
})

test('plain verifier copies never receive env secrets', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({
      source,
      short: 'plain-env',
      members: [{ id: 'worker', role: 'worker' }, { id: 'verifier', role: 'verifier' }],
    })
    assert.equal(existsSync(join(workspaces.members.worker.path, '.env')), true)
    assert.equal(existsSync(join(workspaces.members.verifier.path, '.env')), false)
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})

test('plain evidence is a file manifest, not a diff', async () => {
  const source = sourceDir()
  const previous = process.env.CREW_COPY_ROOT
  const root = temp('lodge-plain-copies-')
  process.env.CREW_COPY_ROOT = root
  try {
    const workspaces = prepareRoom({ source, short: 'plain2', members: [{ id: 'executor', role: 'worker' }] })
    const member = workspaces.members.executor.path
    const result = await changes({ path: member })
    assert.equal(result.diff, '')
    assert.deepEqual(result.files.sort(), ['README.md', 'src/a.txt'])
    assert.match(result.note, /文件清单/)
    assert.equal(typeof head({ path: member }), 'string')
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
      members: [{ id: 'worker', role: 'worker' }, { id: 'worker-2', role: 'worker' }],
    })
    const first = workspaces.members.worker.path
    const second = workspaces.members['worker-2'].path
    const integration = workspaces.integration.path
    const base = manifest({ path: source })
    writeFileSync(join(first, 'src', 'a.txt'), 'from-first\n')
    assert.deepEqual(integrate({ path: integration, source: first, base }), { ok: true })
    assert.equal(readFileSync(join(integration, 'src', 'a.txt'), 'utf8'), 'from-first\n')

    writeFileSync(join(second, 'src', 'a.txt'), 'from-second\n')
    const conflict = integrate({ path: integration, source: second, base })
    assert.equal(conflict.ok, false)
    assert.deepEqual(conflict.files, ['src/a.txt'])
    assert.equal(readFileSync(join(integration, 'src', 'a.txt'), 'utf8'), 'from-first\n')
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})

test('a three-way plain merge propagates deletions and keeps untouched files', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({
      source,
      short: 'plain-delete',
      members: [{ id: 'worker', role: 'worker' }, { id: 'worker-2', role: 'worker' }],
    })
    const first = workspaces.members.worker.path
    const integration = workspaces.integration.path
    const base = manifest({ path: source })
    rmSync(join(first, 'src', 'a.txt'))
    writeFileSync(join(first, 'new.txt'), 'new\n')
    const result = integrate({ path: integration, source: first, base })
    assert.equal(result.ok, true, result.error)
    assert.equal(existsSync(join(integration, 'src', 'a.txt')), false)
    assert.equal(readFileSync(join(integration, 'new.txt'), 'utf8'), 'new\n')
    assert.equal(readFileSync(join(integration, 'README.md'), 'utf8'), '# demo\n')
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})

test('a three-way plain merge reports edit/delete conflicts', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({
      source,
      short: 'plain-delete-conflict',
      members: [{ id: 'worker', role: 'worker' }, { id: 'worker-2', role: 'worker' }],
    })
    const first = workspaces.members.worker.path
    const second = workspaces.members['worker-2'].path
    const integration = workspaces.integration.path
    const base = manifest({ path: source })
    rmSync(join(first, 'src', 'a.txt'))
    writeFileSync(join(second, 'src', 'a.txt'), 'changed\n')
    assert.equal(integrate({ path: integration, source: first, base }).ok, true)
    const conflict = integrate({ path: integration, source: second, base })
    assert.equal(conflict.ok, false)
    assert.deepEqual(conflict.files, ['src/a.txt'])
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})

test('pruning keeps the delivery copy and removes other members', () => {
  const source = sourceDir()
  withRoot(() => {
    const workspaces = prepareRoom({
      source,
      short: 'plain5',
      members: [{ id: 'worker', role: 'worker' }, { id: 'verifier', role: 'verifier' }],
    })
    const room = {
      repoPath: workspaces.roomPath,
      worktrees: { worker: workspaces.members.worker.path, verifier: workspaces.members.verifier.path },
    }
    const pruned = pruneMembers(room)
    assert.deepEqual(pruned, ['verifier'])
    assert.equal(existsSync(workspaces.members.worker.path), true)
    assert.equal(existsSync(workspaces.members.verifier.path), false)
    cleanupRoom({ source, workspaces })
  })
  rmSync(source, { recursive: true, force: true })
})
