import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as desktop from './workspace-desktop.js'

test('the desktop workspace is a copy workspace with hands and one executor', () => {
  const caps = desktop.capabilities()
  assert.equal(caps.desktop, true)
  assert.equal(caps.isolation, 'copy')
  assert.equal(caps.merge, false, 'one desktop, one executor')
})

test('preparing a desktop room creates the artifact folder and gives members copies', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-desktop-ws-'))
  try {
    const source = join(root, 'room')
    const workspaces = desktop.prepareRoom({
      source,
      short: 'abc12345',
      members: [
        { id: 'worker', role: 'worker', roleKind: 'executor' },
        { id: 'verifier', role: 'verifier', roleKind: 'verifier' },
      ],
    })
    assert.ok(existsSync(source), 'the artifact folder exists')
    assert.equal(typeof workspaces.members.worker.path, 'string')
    desktop.cleanupRoom({ source, workspaces })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
