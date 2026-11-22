import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareRoom } from './workspace-direct.js'

test('direct-mode verifier snapshots never receive env secrets', () => {
  const source = mkdtempSync(join(tmpdir(), 'lodge-direct-src-'))
  const copies = mkdtempSync(join(tmpdir(), 'lodge-direct-copies-'))
  const previous = process.env.CREW_COPY_ROOT
  process.env.CREW_COPY_ROOT = copies
  try {
    writeFileSync(join(source, 'README.md'), '# demo\n')
    writeFileSync(join(source, '.env'), 'TOKEN=local\n')
    const workspaces = prepareRoom({
      source,
      short: 'direct-env',
      members: [{ id: 'worker', role: 'worker' }, { id: 'verifier', role: 'verifier' }],
    })
    assert.equal(existsSync(join(workspaces.members.worker.path, '.env')), true)
    assert.equal(existsSync(join(workspaces.members.verifier.path, '.env')), false)
  } finally {
    if (previous === undefined) delete process.env.CREW_COPY_ROOT
    else process.env.CREW_COPY_ROOT = previous
    rmSync(source, { recursive: true, force: true })
    rmSync(copies, { recursive: true, force: true })
  }
})
