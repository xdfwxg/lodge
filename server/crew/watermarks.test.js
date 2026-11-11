import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from './store.js'
import { markSeatRead } from './watermarks.js'

test('marks the seat at the latest room seq and records an event', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-watermark-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-watermark-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    const message = store.appendMessage('r1', { kind: 'system', text: 'hello' })
    const updated = markSeatRead({ store, roomId: 'r1', seat: 'planner' })
    assert.equal(updated.seatCursors.planner, message.seq)
    assert.equal(store.readEvents('r1').at(-1).type, 'room.watermark')
    assert.deepEqual(store.readEvents('r1').at(-1).payload, { seat: 'planner', seq: message.seq })
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})
