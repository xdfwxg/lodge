import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from './store.js'
import { recoverMessages } from './recovery.js'

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-recover-'))
  const repo = mkdtempSync(join(tmpdir(), 'lodge-recover-repo-'))
  const store = createStore({ dataDir })
  store.writeRoom({
    id: 'room-1',
    kind: 'room',
    name: '恢复验证',
    goal: '验证 transcript 崩溃恢复',
    state: 'active',
    repoPath: repo,
    sourceRepo: repo,
    stages: [],
    members: [],
  })
  return { dataDir, repo, store }
}

test('a message written to transcript but missing from SQLite is recovered', () => {
  const ctx = setup()
  try {
    const message = ctx.store.appendMessage('room-1', { kind: 'system', text: '只在日志里' })
    ctx.store.db.prepare('DELETE FROM messages WHERE id = ?').run(message.id)
    assert.equal(ctx.store.readMessages('room-1').length, 0)
    const result = recoverMessages(ctx.store)
    assert.equal(result.recovered, 1)
    const recovered = ctx.store.readMessages('room-1')[0]
    assert.equal(recovered.id, message.id)
    assert.equal(recovered.text, '只在日志里')
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('recovery never overwrites a newer SQLite version with a transcript line', () => {
  const ctx = setup()
  try {
    const message = ctx.store.appendMessage('room-1', { kind: 'chat', text: '流式片段' })
    ctx.store.upsertMessage({ ...message, text: '最终版本', meta: { ...message.meta, final: true } })
    recoverMessages(ctx.store)
    assert.equal(ctx.store.readMessages('room-1')[0].text, '最终版本')
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})
