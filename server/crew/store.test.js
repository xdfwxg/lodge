import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from './store.js'

test('a store opened without a database reports a fresh start', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-store-fresh-'))
  try {
    const first = createStore({ dataDir })
    assert.equal(first.fresh, true)
    first.db.close()
    const second = createStore({ dataDir })
    assert.equal(second.fresh, false)
    second.db.close()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

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
    store.appendMessage('r1', { kind: 'system', text: 'two' })
    store.appendMessage('r1', { kind: 'system', text: 'three' })
    assert.deepEqual(store.readRecentMessages('r1', 2).map(message => message.text), ['two', 'three'])
    assert.equal(store.maxMessageSeq('r1'), store.readMessages('r1').at(-1).seq)
    const transcript = join(repo, '.crew', 'rooms', 'r1', 'transcript.jsonl')
    assert.equal(existsSync(transcript), true)
    assert.match(readFileSync(transcript, 'utf8'), /hello/)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('the current user is one global profile that survives a reopen', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-profile-'))
  try {
    const first = createStore({ dataDir })
    assert.deepEqual(first.readProfile(), { name: '', avatar: null, updatedAt: null })
    first.writeProfile({ name: '千寻', avatar: 'data:image/jpeg;base64,abc' })
    assert.equal(first.readProfile().name, '千寻')
    first.db.close()

    const second = createStore({ dataDir })
    assert.equal(second.readProfile().name, '千寻')
    assert.equal(second.readProfile().avatar, 'data:image/jpeg;base64,abc')
    second.writeProfile({ name: '阿洛', avatar: null })
    assert.equal(second.readProfile().name, '阿洛')
    second.db.close()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('activity steps and audit events keep only the recent window', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-retention-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-retention-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', kind: 'room', name: 'R', goal: 'g', state: 'active', repoPath: repo, stages: [], members: [] })
    for (const text of ['one', 'two', 'three']) {
      store.appendMessage('r1', { kind: 'activity', text })
    }
    store.appendMessage('r1', { kind: 'chat', text: 'keep me' })
    assert.equal(store.pruneActivityMessages('r1', { keep: 1 }), 2)
    assert.deepEqual(store.readMessages('r1').filter(message => message.kind === 'activity').map(message => message.text), ['three'])
    assert.equal(store.readMessages('r1').some(message => message.text === 'keep me'), true)
    for (let index = 0; index < 3; index += 1) store.appendEvent('r1', `room.test.${index}`, {})
    assert.equal(store.pruneEvents('r1', { keep: 1 }), 2)
    assert.equal(store.readEvents('r1').length, 1)
  } finally {
    store.db.close()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('deleting a room removes its messages and events but keeps other rooms', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-delete-store-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-delete-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R1', goal: 'g', repoPath: repo, state: 'complete', stages: [], members: [] })
    store.writeRoom({ id: 'r2', name: 'R2', goal: 'g', repoPath: repo, state: 'complete', stages: [], members: [] })
    store.appendMessage('r1', { kind: 'system', text: 'hello' })
    store.appendEvent('r1', 'room.conclusion', {})
    store.enqueueWork({ roomId: 'r1', kind: 'run', payload: {} })
    store.enqueueWork({ roomId: 'r1', kind: 'run', availableAt: Date.now() + 60_000 })
    store.appendMessage('r2', { kind: 'system', text: 'keep me' })

    assert.equal(store.deleteRoom('r1'), true)
    assert.equal(store.readRoom('r1'), null)
    assert.deepEqual(store.readMessages('r1'), [])
    assert.deepEqual(store.readEvents('r1'), [])
    assert.deepEqual(store.readWork('r1'), [])
    assert.equal(store.readRoom('r2').id, 'r2')
    assert.equal(store.readMessages('r2').length, 1)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a message id cannot move to another room', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-message-scope-'))
  const repo = mkdtempSync(join(tmpdir(), 'crew-message-scope-repo-'))
  const store = createStore({ dataDir })
  try {
    store.writeRoom({ id: 'r1', name: 'R1', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    store.writeRoom({ id: 'r2', name: 'R2', goal: 'g', repoPath: repo, state: 'active', stages: [], members: [] })
    const stored = store.appendMessage('r1', { kind: 'system', text: 'mine' })
    assert.equal(store.upsertMessage({ ...stored, roomId: 'r2', text: 'not mine' }), null)
    assert.equal(store.readMessages('r1')[0].text, 'mine')
    assert.deepEqual(store.readMessages('r2'), [])
  } finally {
    store.db.close()
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

test('command and manual evidence are read from the message stream, turn reports are not', () => {
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
    const evidence = store.readEvidence('r1')
    assert.deepEqual(evidence.map(item => item.id), [command.id, manual.id])
    assert.equal(evidence.some(item => item.meta?.kind === 'turn'), false)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('assignments page by cursor and prune only terminal rows', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-assignment-store-'))
  const store = createStore({ dataDir })
  try {
    for (let at = 1; at <= 5; at += 1) {
      store.writeAssignment({
        id: `as-${at}`,
        roomId: 'r1',
        stageIndex: 0,
        status: 'passed',
        createdAt: at,
        updatedAt: at,
      })
    }
    store.writeAssignment({
      id: 'as-open',
      roomId: 'r1',
      stageIndex: 0,
      status: 'sent',
      createdAt: 6,
      updatedAt: 6,
    })
    assert.deepEqual(store.readAssignments('r1', { limit: 2 }).map(item => item.id), ['as-5', 'as-open'])
    assert.deepEqual(store.readAssignments('r1', { limit: 2, before: 'as-5' }).map(item => item.id), ['as-3', 'as-4'])
    assert.equal(store.pruneAssignments('r1', { keep: 2 }), 3)
    assert.deepEqual(store.readAssignments('r1').map(item => item.id), ['as-4', 'as-5', 'as-open'])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('work items dedupe and timers survive a reopen', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-work-store-'))
  let store = createStore({ dataDir })
  try {
    const first = store.enqueueWork({ roomId: 'r1', kind: 'approval', dedupeKey: 'timer:1', payload: { approvalId: 'a1' } })
    assert.notEqual(first, null)
    assert.equal(store.enqueueWork({ roomId: 'r1', kind: 'approval', dedupeKey: 'timer:1' }), null)
    const claimed = store.claimWork('r1')
    assert.equal(claimed.id, first.id)
    assert.equal(store.claimWork('r1'), null)
    store.completeWork(claimed.id)

    store.enqueueWork({ id: 'timer-1', roomId: 'r1', kind: 'approval', availableAt: Date.now() - 1, payload: { approvalId: 'a1' } })
    store.cancelWork('timer-1')
    store.enqueueWork({ id: 'timer-1', roomId: 'r1', kind: 'approval', availableAt: Date.now() - 1, payload: { approvalId: 'a1' } })
    store.db.close()
    store = createStore({ dataDir })
    const timer = store.claimWork('r1')
    assert.equal(timer.id, 'timer-1')
    assert.equal(timer.kind, 'approval')
    store.completeWork(timer.id)
    assert.equal(store.claimWork('r1'), null)
  } finally {
    store.db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
