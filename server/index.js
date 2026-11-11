import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = join(root, '.data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'crew.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS room (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`)

const ROOM_ID = 'room-cli-verbose'

const SEATS = [
  { id: 'planner', name: 'Planner', title: '总编排', station: '只读 · 拆阶段与派活', engine: 'claude', permissions: 'read' },
  { id: 'executor', name: 'Executor', title: '执行', station: 'worktree 写 · 改代码跑测试', engine: 'codex', permissions: 'write' },
  { id: 'verifier', name: 'Verifier', title: '验收', station: '只读副本 · 独立复核', engine: 'claude', permissions: 'read' },
]

const SEED_ROOM = {
  id: ROOM_ID,
  name: 'CLI 加 --verbose',
  goal: '给 CLI 加 --verbose；默认输出必须逐字节不变',
  independence: 'vendor',
  members: SEATS.map(seat => seat.id),
  stages: [
    { title: '调研与接口设计', kind: 'decision', state: 'passed' },
    { title: '实现 --verbose', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
    { title: '回归与文档', kind: 'deliverable', state: 'pending', acceptance: 'npm test && ./scripts/e2e.sh' },
  ],
}

const now = Date.now()
const SEED_MESSAGES = [
  { kind: 'system', text: '目标已对齐 · 3 个阶段 · 完成由你签字', at: -18 * 60_000 },
  { kind: 'chat', authorId: 'you', text: '做 `--verbose`。默认输出必须逐字节不变。先给方案，别动代码。', at: -17 * 60_000 },
  {
    kind: 'chat',
    authorId: 'planner',
    at: -15 * 60_000,
    text: [
      '按 done 拆成三段。第 1 段是决策型，需要你点一次；后两段都有可执行命令。',
      '',
      '| 阶段 | 类型 | 谁做 | 验收 |',
      '| --- | --- | --- | --- |',
      '| 1 调研与接口设计 | 决策 | Planner | 你确认接口形状 |',
      '| 2 实现 --verbose | 交付 | Executor | `npm test` 退出码 0，默认输出 diff 为空 |',
      '| 3 回归与文档 | 交付 | Executor | `npm test && ./scripts/e2e.sh` |',
      '',
      '@Executor 阶段 2 的写范围只有 `src/cli.js` 和 `test/cli.test.js`。默认一次只派一个子任务，报完工附证据再推进。',
    ].join('\n'),
  },
  { kind: 'system', text: '阶段 1 由你确认 · 接口形状：`--verbose` 只影响 stderr，stdout 逐字节不变', at: -12 * 60_000 },
  { kind: 'system', text: '阶段 2 已开始 · Executor 在自己的 worktree 里工作', at: -11 * 60_000 },
  {
    kind: 'chat',
    authorId: 'executor',
    at: -6 * 60_000,
    text: [
      '改完了，没动依赖。',
      '',
      '- `src/cli.js`：新增 `--verbose`，日志只走 stderr；默认路径仍先写同一个 buffer 再一次性输出',
      '- `test/cli.test.js`：加 3 条用例，其中一条逐字节比对默认输出',
      '',
      '跑了 `npm test`，证据在下面。',
    ].join('\n'),
  },
  {
    kind: 'evidence',
    authorId: 'executor',
    at: -5 * 60_000,
    meta: {
      stage: 1,
      command: 'npm test',
      exit: 0,
      durationMs: 4120,
      files: ['src/cli.js', 'test/cli.test.js'],
      output: '> cli@1.2.0 test\n> node --test\n\n✔ defaults are byte-identical (12ms)\n✔ --verbose logs to stderr (4ms)\n✔ --verbose with --json stays machine-readable (3ms)\n\n3 passing',
      diff: 'diff --git a/src/cli.js b/src/cli.js\n@@\n-  process.stdout.write(out)\n+  if (opts.verbose) process.stderr.write(`[cli] ${line}\\n`)\n+  process.stdout.write(out)',
    },
  },
  {
    kind: 'verdict',
    authorId: 'verifier',
    at: -3 * 60_000,
    text: '复跑通过。另抽查默认输出与基线逐字节一致；`--verbose --json` 时 stderr 不污染 JSON。没有发现越界改动。',
    meta: { pass: true, stage: 1, command: 'npm test', exit: 0 },
  },
  { kind: 'system', text: '阶段 2 已通过 · 等你点「接受这一阶段」', at: -2 * 60_000 },
]

const roomRow = db.prepare('SELECT payload FROM room WHERE id = ?').get(ROOM_ID)
if (roomRow === undefined) {
  db.prepare('INSERT INTO room (id, payload) VALUES (?, ?)').run(ROOM_ID, JSON.stringify(SEED_ROOM))
  const insert = db.prepare('INSERT INTO messages (seq, id, room_id, payload) VALUES (?, ?, ?, ?)')
  let seq = 0
  for (const seed of SEED_MESSAGES) {
    const { at, ...rest } = seed
    const message = { ...rest, id: randomUUID(), roomId: ROOM_ID, seq: seq + 1, ts: now + at }
    insert.run(message.seq, message.id, ROOM_ID, JSON.stringify(message))
    seq = message.seq
  }
}

const readRoom = () => JSON.parse(db.prepare('SELECT payload FROM room WHERE id = ?').get(ROOM_ID).payload)
const writeRoom = room => db.prepare('UPDATE room SET payload = ? WHERE id = ?').run(JSON.stringify(room), ROOM_ID)
const readMessages = since => db.prepare('SELECT payload FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq')
  .all(ROOM_ID, since)
  .map(row => JSON.parse(row.payload))
const nextSeq = () => Number(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE room_id = ?').get(ROOM_ID).next)

const clients = new Set()

const send = (res, event, payload, id) => {
  res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}
const broadcast = (event, payload, id) => {
  for (const client of clients) send(client, event, payload, id)
}

const appendMessage = message => {
  const stored = { ...message, id: randomUUID(), roomId: ROOM_ID, seq: nextSeq(), ts: Date.now() }
  db.prepare('INSERT INTO messages (seq, id, room_id, payload) VALUES (?, ?, ?, ?)')
    .run(stored.seq, stored.id, ROOM_ID, JSON.stringify(stored))
  broadcast('msg', stored, stored.seq)
  return stored
}

const json = (res, status, body) => {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

const readJson = req => new Promise((resolveBody, reject) => {
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', chunk => {
    raw += chunk
    if (raw.length > 64 * 1024) {
      reject(new Error('请求体过大'))
      req.destroy()
    }
  })
  req.on('end', () => {
    try {
      resolveBody(raw === '' ? {} : JSON.parse(raw))
    } catch {
      reject(new Error('请求体不是 JSON'))
    }
  })
  req.on('error', reject)
})

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

const serveStatic = (req, res, pathname) => {
  const dist = join(root, 'ui', 'dist')
  if (!existsSync(dist)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('UI 尚未构建：开发时用 npm run dev，或先 npm run build。')
    return
  }
  const wanted = pathname === '/' ? '/index.html' : normalize(pathname)
  const file = join(dist, wanted)
  if (!file.startsWith(dist) || !existsSync(file)) {
    const fallback = join(dist, 'index.html')
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(readFileSync(fallback))
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname

  try {
    if (path === '/api/state' && req.method === 'GET') {
      return json(res, 200, { room: readRoom(), seats: SEATS, messages: readMessages(0) })
    }

    if (path === '/api/events' && req.method === 'GET') {
      const since = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0) || 0
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write('retry: 2000\n\n')
      for (const message of readMessages(since)) send(res, 'msg', message, message.seq)
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (path === '/api/messages' && req.method === 'POST') {
      const body = await readJson(req)
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 8000) return json(res, 400, { error: '消息不能为空，且不超过 8000 字' })
      const message = appendMessage({ kind: 'chat', authorId: 'you', text })
      return json(res, 201, { message })
    }

    if (path === '/api/accept' && req.method === 'POST') {
      const body = await readJson(req)
      const index = Number(body.stage)
      const room = readRoom()
      const stage = room.stages[index]
      if (!Number.isInteger(index) || stage === undefined) return json(res, 400, { error: '没有这个阶段' })
      if (stage.state !== 'active') return json(res, 409, { error: '这个阶段不在待验收状态' })

      stage.state = 'passed'
      const next = room.stages.findIndex(item => item.state === 'pending')
      if (next >= 0) room.stages[next].state = 'active'
      writeRoom(room)
      broadcast('room', room)
      const text = next >= 0
        ? `阶段 ${index + 1} 已由你验收 · 进入阶段 ${next + 1}：${room.stages[next].title}`
        : `阶段 ${index + 1} 已由你验收 · 全部阶段已通过，请你对目标做最终确认`
      appendMessage({ kind: 'system', text })
      return json(res, 200, { room })
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: '没有这个接口' })
    if (req.method !== 'GET') return json(res, 405, { error: '只接受 GET' })
    return serveStatic(req, res, path)
  } catch (error) {
    return json(res, 500, { error: String(error?.message ?? error) })
  }
})

setInterval(() => {
  for (const client of clients) client.write(': ping\n\n')
}, 25_000).unref()

const port = Number(process.env.CREW_PORT ?? 8787)
server.listen(port, '127.0.0.1', () => {
  console.log(`Crew Chat server: http://127.0.0.1:${port}`)
})
