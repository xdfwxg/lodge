import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRoomMemory, memoryKeyFor } from './memory.js'

const room = over => ({
  id: 'room-1',
  name: '发布说明',
  goal: '补一版发布说明',
  sourceRepo: '/workspace/project',
  completedAt: 100,
  completedCommit: 'abc123',
  stages: [{ title: '写说明', state: 'passed' }],
  ...over,
})

const withStore = fn => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-memory-'))
  try {
    return fn(createRoomMemory({ root }), root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a completed room appends one read-only record per workspace', () => withStore((memory, root) => {
  const messages = [
    { kind: 'verdict', text: 'PASS', meta: { pass: true, reason: '符合目标' } },
    { kind: 'conclusion', text: '已交付：补一版发布说明' },
    { kind: 'evidence', meta: { changedFiles: ['RELEASE.md', 'RELEASE.md', '.crew/x'] } },
  ]
  const result = memory.appendRoom({ room: room(), messages })
  assert.equal(result.ok, true)
  assert.equal(memory.appendRoom({ room: room(), messages }).duplicate, true)
  const entries = memory.list({ room: room() })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].goal, '补一版发布说明')
  assert.equal(entries[0].conclusion, '符合目标')
  assert.equal(entries[0].verdict.reason, '符合目标')
  assert.deepEqual(entries[0].files, ['RELEASE.md', '.crew/x'])
  assert.equal(entries[0].commit, 'abc123')
  assert.equal(entries[0].commitSource, 'room')
  assert.equal(entries[0].status, 'draft')
  const file = join(root, `${memoryKeyFor(room())}.jsonl`)
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1)
}))

test('only approved entries are shared with new rooms', () => withStore(memory => {
  memory.appendRoom({ room: room(), messages: [{ kind: 'verdict', text: 'PASS', meta: { pass: true, reason: '符合目标' } }] })
  assert.deepEqual(memory.shared({ room: room() }), [])
  const approved = memory.review({ room: room(), memoryId: 'room-1', decision: 'approve' })
  assert.equal(approved.ok, true)
  assert.equal(approved.entries[0].status, 'approved')
  const shared = memory.shared({ sourceRepo: '/workspace/project' })
  assert.equal(shared.length, 1)
  assert.equal(shared[0].goal, '补一版发布说明')
  const rejected = memory.review({ room: room(), memoryId: 'room-1', decision: 'reject' })
  assert.equal(rejected.entries[0].status, 'rejected')
  assert.deepEqual(memory.shared({ room: room() }), [])
}))

test('reviewing a missing entry or an unknown decision is refused', () => withStore(memory => {
  assert.equal(memory.review({ room: room(), memoryId: 'missing', decision: 'approve' }).ok, false)
  memory.appendRoom({ room: room(), messages: [] })
  assert.equal(memory.review({ room: room(), memoryId: 'room-1', decision: 'maybe' }).reason, 'invalid')
}))

test('a room without a recorded commit keeps the workspace head it was written at', () => withStore(memory => {
  const result = memory.appendRoom({ room: room({ completedCommit: undefined, workspaceHead: 'head-9' }), messages: [] })
  assert.equal(result.ok, true)
  const entry = memory.list({ room: room() })[0]
  assert.equal(entry.commit, 'head-9')
  assert.equal(entry.commitSource, 'workspace-head')
}))

test('demos and rooms without a workspace do not write memory', () => withStore(memory => {
  assert.equal(memory.appendRoom({ room: room({ demo: true }) }).ok, false)
  assert.equal(memory.appendRoom({ room: room({ sourceRepo: '', repoPath: '' }) }).ok, false)
}))

test('a full workspace stops appending instead of growing forever', () => withStore(memory => {
  for (let index = 0; index < 200; index += 1) {
    const result = memory.appendRoom({ room: room({ id: `room-${index}` }), messages: [] })
    assert.equal(result.ok, true, result.reason)
  }
  const blocked = memory.appendRoom({ room: room({ id: 'room-over' }), messages: [] })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'limit')
}))
