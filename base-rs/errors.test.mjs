// 写库失败要向上抛：HTTP 返回 500，不假装保存成功。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', 'lodge-base-slice')
const port = 21500 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-errors-'))
const dbPath = join(dataDir, 'base.db')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', dbPath, '--fake'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  const client = createBaseClient({ baseUrl })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec("CREATE TRIGGER fail_bot BEFORE INSERT ON bots BEGIN SELECT RAISE(ABORT, 'test write failure'); END")
    await assert.rejects(
      () => client.createBot({
        name: '写不进去',
        modelSelection: { instanceId: 'fake', model: 'fake/echo' },
        settings: { toolScope: { deny: [] } },
      }),
      /base 500/,
    )
    const bootstrap = await client.bootstrap()
    assert.equal(bootstrap.bots.length, 0, 'nothing was saved on failure')

    db.exec('DROP TRIGGER fail_bot')
    const created = await client.createBot({
      name: '写进去了',
      modelSelection: { instanceId: 'fake', model: 'fake/echo' },
      settings: { toolScope: { deny: [] } },
    })
    assert.equal(typeof created.bot?.id, 'string')

    // 事件落库失败：状态还能存，但 health 必须承认 degraded。
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'event write failure'); END")
    await client.createGroup({ name: '事件写失败', memberIds: [] })
    const degraded = await (await fetch(`${baseUrl}/api/health`)).json()
    assert.equal(degraded.storage, 'degraded')
    db.exec('DROP TRIGGER fail_event')

    // 读到的坏数据也不能伪装成“空历史”：历史接口返回 500。
    db.exec("INSERT INTO events (id, thread_id, seq, at, kind, payload) VALUES ('bad','corrupt-thread',999999,1,'message','{not json')")
    const corrupt = await fetch(`${baseUrl}/api/threads/corrupt-thread/messages`)
    assert.equal(corrupt.status, 500)
    db.exec("DELETE FROM events WHERE id = 'bad'")
    const recovered = await fetch(`${baseUrl}/api/threads/corrupt-thread/messages`)
    assert.equal(recovered.status, 200)

    // 非法回答在碰卡之前就被拒绝。
    const invalid = await fetch(`${baseUrl}/api/threads/x/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'nope', behavior: 'maybe' }),
    })
    assert.equal(invalid.status, 400)
  } finally {
    db.close()
  }
  console.log('base-rs errors: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
