import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createStore } from './store.js'

test('room updates are versioned inside a transaction and write events', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-store-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    assert.equal(store.readRoom('r1').version, 1)

    const paused = store.updateRoom('r1', room => {
      room.state = 'paused'
      return { events: [{ type: 'room.state', payload: { state: 'paused' } }] }
    })
    assert.equal(paused.state, 'paused')
    assert.equal(store.readRoom('r1').version, 2)
    assert.equal(store.readEvents('r1').length, 1)
    assert.equal(store.readEvents('r1')[0].type, 'room.state')

    assert.equal(store.updateRoom('r1', () => null), null)
    assert.equal(store.readRoom('r1').version, 2)

    store.appendMessage('r1', { kind: 'system', text: 'hello' })
    const transcript = join(repo, '.crew', 'rooms', 'r1', 'transcript.jsonl')
    assert.equal(existsSync(transcript), true)
    assert.match(readFileSync(transcript, 'utf8'), /hello/)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('room events are mirrored into the room repo for handoff', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-event-store-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-event-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    store.appendEvent('r1', 'room.created', { seats: 1 })
    const log = join(repo, '.crew', 'rooms', 'r1', 'events.jsonl')
    assert.equal(existsSync(log), true)
    const events = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.equal(events.at(-1).type, 'room.created')
    assert.deepEqual(events.at(-1).payload, { seats: 1 })
    assert.equal(events.at(-1).roomId, 'r1')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a failed event mirror does not reverse the committed event', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-mirror-store-'))
  const parent = mkdtempSync(join(tmpdir(), 'crew-mirror-parent-'))
  const notADir = join(parent, 'not-a-repo-dir')
  writeFileSync(notADir, 'file')
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: notADir, state: 'active', stages: [], members: [] })
    assert.doesNotThrow(() => store.appendEvent('r1', 'room.created', { seats: 1 }))
    assert.equal(store.readEvents('r1').length, 1)
    assert.equal(store.readEvents('r1')[0].type, 'room.created')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(parent, { recursive: true, force: true })
  }
})

test('an old room table without version migrates additively', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-old-store-'))
  const db = new DatabaseSync(join(dataDir, 'crew.db'))
  db.exec('CREATE TABLE room (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  db.prepare('INSERT INTO room (id, payload) VALUES (?, ?)').run(
    'old-room',
    JSON.stringify({ id: 'old-room', name: 'Old', goal: 'g', state: 'active', stages: [], members: [] }),
  )
  db.close()
  const store = createStore({ dataDir })
  try {
    assert.equal(store.readRoom('old-room').version, 1)
    const next = store.updateRoom('old-room', room => {
      room.state = 'paused'
      return { events: [{ type: 'room.state', payload: { state: 'paused' } }] }
    })
    assert.equal(next.version, 2)
    assert.equal(store.readEvents('old-room').length, 1)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('command and manual evidence enter the append-only ledger, turn reports do not', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-ledger-store-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-ledger-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    const command = store.appendMessage('r1', {
      kind: 'evidence',
      authorId: 'system',
      text: 'command ok',
      meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0, diff: 'D', files: ['a.js'] },
    })
    const manual = store.appendMessage('r1', {
      kind: 'evidence',
      authorId: 'worker',
      text: 'artifact ready',
      meta: { kind: 'manual', stage: 1, repoPath: repo },
    })
    store.appendMessage('r1', {
      kind: 'evidence',
      authorId: 'worker',
      text: 'self report',
      meta: { kind: 'turn', stage: 1, turnId: 't1' },
    })
    const ledger = store.readEvidence('r1')
    assert.deepEqual(ledger.map(item => item.id), [command.id, manual.id])
    assert.match(ledger[0].digest, /^[a-f0-9]{64}$/)
    assert.equal(ledger.some(item => item.meta?.kind === 'turn'), false)

    const before = ledger.length
    store.appendEvidenceFromMessage(command)
    assert.equal(store.readEvidence('r1').length, before)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('an old room backfills its evidence ledger from existing evidence messages', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-ledger-backfill-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-ledger-backfill-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    const stored = store.appendMessage('r1', {
      kind: 'evidence',
      authorId: 'system',
      text: 'old command',
      meta: { kind: 'command', stage: 1, command: 'true', exit: 0 },
    })
    store.db.prepare('DELETE FROM evidence').run()
    const ledger = store.readEvidence('r1')
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0].id, stored.id)
    assert.equal(ledger[0].meta.exit, 0)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})
