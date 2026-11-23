// 历史检索基准：不走模型，只测长房间里的查询耗时。
// 5k 条消息直接写进 SQLite 与 FTS 索引（跳过逐条镜像），查询走真实的 searchMessages。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../../server/crew/store.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const count = Math.max(100, Number(option('--count', '5000')) || 5000)
const queries = Math.max(3, Number(option('--queries', '20')) || 20)
const maxP95 = Math.max(10, Number(option('--max-ms', '250')) || 250)

const percentile = (values, at) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((at / 100) * sorted.length) - 1))]
}

const dataDir = mkdtempSync(join(tmpdir(), 'lodge-history-bench-'))
const repo = mkdtempSync(join(tmpdir(), 'lodge-history-bench-repo-'))
const store = createStore({ dataDir })
try {
  store.writeRoom({ id: 'bench', name: 'bench', goal: 'bench', repoPath: repo, state: 'active', stages: [], members: [] })
  const insert = store.db.prepare('INSERT INTO messages (seq, id, room_id, payload) VALUES (?, ?, ?, ?)')
  const index = store.db.prepare('INSERT INTO message_fts (text, room_id, message_id, author_id, ts) VALUES (?, ?, ?, ?, ?)')
  const seedStarted = Date.now()
  store.db.exec('BEGIN')
  for (let at = 1; at <= count; at += 1) {
    const text = at % 50 === 0
      ? '上次为什么选拼音方案：跨平台，不用换输入法。'
      : `第 ${at} 条普通消息：今天聊了房间、成员和下一步。`
    const ts = 1_700_000_000_000 + at
    const id = `m-${at}`
    insert.run(at, id, 'bench', JSON.stringify({ id, roomId: 'bench', kind: 'chat', authorId: 'you', ts, text }))
    index.run(text, 'bench', id, 'you', ts)
  }
  store.db.exec('COMMIT')
  const seedMs = Date.now() - seedStarted

  const samples = []
  for (let at = 0; at < queries; at += 1) {
    const query = at % 2 === 0 ? '为什么 拼音 方案' : '房间 成员 下一步'
    const startedAt = performance.now()
    const hits = store.searchMessages('bench', query, { limit: 4 })
    samples.push(performance.now() - startedAt)
    if (hits.length === 0) throw new Error(`没有命中：${query}`)
  }
  const p50 = percentile(samples, 50)
  const p95 = percentile(samples, 95)
  console.log(`history-bench · ${count} 条 · ${queries} 次查询 · 建索引 ${seedMs}ms · p50 ${p50.toFixed(2)}ms · p95 ${p95.toFixed(2)}ms · 阈值 ${maxP95}ms`)
  process.exitCode = p95 > maxP95 ? 1 : 0
} finally {
  store.db.close()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
}
