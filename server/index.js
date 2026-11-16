import http from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCrewPorts } from './crew/crew-ports.js'
import { createLiveRooms } from './crew/rooms/base/live.js'
import { acquireDataLock } from './crew/lock.js'
import { presentRoom } from './crew/presentation.js'
import { createCrewService } from './crew/service.js'
import { openPath } from './system-open.js'
import { collectWorkspaceGarbage } from './crew/workspace-gc.js'
import { ROLES, validateRoster } from './crew/roster.js'
import { assertRuntimePort } from './crew/runtime-port.js'
import { compactAssignments, pageAssignments } from './crew/assignment-history.js'
import { migrateAssignments } from './crew/assignment-migration.js'
import { migrateRoomMembers } from './crew/room-members.js'
import { createStore } from './crew/store.js'
import { createEngine } from './engine.js'
import { chooseDirectory } from './system-dialog.js'
import { requestGuard } from './http-guard.js'
import { recoverMessages } from './crew/recovery.js'
import { pruneBackups, snapshotDatabase } from './crew/data-recovery.js'

// 组合根：只做装配与 HTTP 传输，业务全在 server/crew/。
validateRoster(ROLES)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = process.env.CREW_DATA_DIR === undefined ? join(root, '.data') : resolve(process.env.CREW_DATA_DIR)
acquireDataLock(dataDir)

const clients = new Set()
const send = (res, event, payload, id) => {
  res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}
const broadcast = (event, payload, id) => {
  for (const client of clients) send(client, event, payload, id)
}

// schema 迁移前先对旧库做快照；CLI 恢复也用同一份快照格式。
try {
  const file = snapshotDatabase({ dataDir, reason: 'startup', keep: 10 })
  if (file !== null) console.log(`store snapshot: ${file}`)
} catch (error) {
  console.warn(`store snapshot failed: ${error?.message ?? error}`)
}

const store = createStore({ dataDir, emit: broadcast })
migrateRoomMembers(store)
migrateAssignments(store)
compactAssignments(store)

// 补齐“transcript 已 fsync、SQLite 还没写”的崩溃窗口；库仍是唯一真相。
try {
  const recovered = recoverMessages(store)
  if (recovered.recovered > 0 || recovered.events > 0) {
    console.log(`recovered ${recovered.recovered} messages and ${recovered.events} events from room logs`)
  }
  if (recovered.roomsWithoutTranscript.length > 0) {
    console.warn(`transcript unavailable: ${recovered.roomsWithoutTranscript.join(', ')}`)
  }
} catch (error) {
  console.warn(`message recovery failed: ${error?.message ?? error}`)
}

const compactHistory = () => {
  let activities = 0
  let events = 0
  for (const room of store.readRooms()) {
    if (room.demo === true) continue
    activities += store.pruneActivityMessages(room.id, { keep: 2000 })
    events += store.pruneEvents(room.id, { keep: 5000 })
  }
  if (activities > 0 || events > 0) console.log(`history compacted: ${activities} steps, ${events} events`)
}

const snapshotNow = reason => {
  try {
    compactHistory()
    mkdirSync(join(dataDir, 'backups'), { recursive: true })
    const file = join(dataDir, 'backups', `crew-${Date.now()}-${reason}.db`)
    store.backup(file)
    pruneBackups(dataDir, 10)
  } catch (error) {
    console.warn(`store backup failed: ${error?.message ?? error}`)
  }
}
compactHistory()
setInterval(() => snapshotNow('periodic'), 6 * 60 * 60 * 1000).unref()

// 房间事件和 /api/state 用同一份投影；UI 只消费 needsYou/独立性文案。
const emit = (event, payload, id) => {
  if (event === 'room' && payload !== null && typeof payload?.id === 'string') {
    payload = presentRoom(payload, store.readRecentMessages(payload.id), store.readAssignments(payload.id, { limit: 500 }))
  }
  broadcast(event, payload, id)
}

const engine = assertRuntimePort(createEngine())

let service = null
const ports = createCrewPorts()

const live = createLiveRooms({
  store,
  engine,
  emit,
  ports,
})

service = createCrewService({
  store,
  engine,
  live,
  emit,
  roles: ROLES,
  ports,
})

const runWorkspaceGc = () => {
  try {
    const result = collectWorkspaceGarbage({ store, workspace: ports.workspace, files: ports.files })
    if (result.pruned > 0 || result.orphans > 0 || result.rewound > 0) {
      console.log(`workspace gc: pruned ${result.pruned} members, removed ${result.orphans} orphan dirs, pruned ${result.rewound} rewind branches`)
    }
  } catch (error) {
    console.warn(`workspace gc failed: ${error?.message ?? error}`)
  }
}
void runWorkspaceGc()
setInterval(runWorkspaceGc, 6 * 60 * 60 * 1000).unref()

const json = (res, status, body) => {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

const STATUS = { invalid: 400, not_found: 404, conflict: 409, method: 405 }
const respond = (res, result) => {
  if (result.ok === false) return json(res, STATUS[result.reason] ?? 500, { error: result.error })
  if ('bytes' in result) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': result.bytes.length })
    return res.end(result.bytes)
  }
  const status = result.created === true ? 201 : result.accepted === true ? 202 : 200
  return json(res, status, result.body)
}

const readJson = (req, limit = 64 * 1024) => new Promise((resolveBody, reject) => {
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', chunk => {
    raw += chunk
    if (raw.length > limit) {
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

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

const htmlHeaders = { 'content-type': MIME['.html'], 'content-security-policy': CSP }

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
    res.writeHead(200, htmlHeaders)
    res.end(readFileSync(fallback))
    return
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream'
  res.writeHead(200, type.startsWith('text/html') ? { ...htmlHeaders, 'content-type': type } : { 'content-type': type })
  res.end(readFileSync(file))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname

  try {
    const blocked = requestGuard(req)
    if (blocked !== null) return json(res, 403, { error: blocked })

    if (path === '/api/state' && req.method === 'GET') {
      return json(res, 200, await service.state())
    }

    if (path === '/api/health' && req.method === 'GET') {
      const result = await service.health()
      if (result?.ok !== false && result.body !== undefined) {
        try {
        } catch {}
      }
      return respond(res, result)
    }

    if (path === '/api/system/choose-directory' && req.method === 'POST') {
      if (process.platform !== 'darwin') {
        return json(res, 501, { error: '当前系统还不支持从 web 选择目录；请粘贴目录路径' })
      }
      return json(res, 200, await chooseDirectory())
    }

    if (path === '/api/system/open-path' && req.method === 'POST') {
      const body = await readJson(req)
      if (typeof body.path !== 'string' || body.path.trim() === '') {
        return json(res, 400, { error: '缺少路径' })
      }
      await openPath(body.path)
      return json(res, 200, { ok: true })
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
      for (const message of service.messagesSince(since)) send(res, 'msg', message, message.seq)
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }


    if (path === '/api/roster/recommend' && req.method === 'POST') {
      return respond(res, await service.recommendRoster(await readJson(req)))
    }

    if (path === '/api/rooms' && req.method === 'POST') {
      return respond(res, await service.createRoom(await readJson(req)))
    }

    if (path === '/api/rooms/sample' && req.method === 'POST') {
      return respond(res, await service.createSampleRoom())
    }

    const assignmentsPath = path.match(/^\/api\/rooms\/([\w-]+)\/assignments$/)
    if (assignmentsPath !== null && req.method === 'GET') {
      const [, roomId] = assignmentsPath
      const stage = url.searchParams.get('stage')
      const page = pageAssignments(store, roomId, {
        stage: stage === null || stage === '' ? null : Number(stage),
        status: url.searchParams.get('status'),
        before: url.searchParams.get('before'),
        limit: Number(url.searchParams.get('limit') ?? 50),
      })
      return json(res, 200, page)
    }

    const evidencePath = path.match(/^\/api\/rooms\/([\w-]+)\/evidence\/([\w-]+)$/)
    if (evidencePath !== null && req.method === 'GET') {
      const [, roomId, messageId] = evidencePath
      return respond(res, service.evidence(roomId, messageId))
    }

    const roomAction = path.match(/^\/api\/rooms\/([^/]+)\/(messages|accept|chat-accept|chat-continue|chat-resume|reject-plan|rework|read|hold|steer|cancel-queue|answer-card|acceptance|verify|approvals|subrooms|add-member|swap-body|rename|shadow-review|archive|delete)$/)
    if (roomAction !== null) {
      const [, roomId, action] = roomAction
      return respond(res, await service.roomRequest(roomId, action, {
        method: req.method,
        readBody: () => readJson(req),
      }))
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

setInterval(() => {
}, 60_000).unref()

const port = Number(process.env.CREW_PORT ?? 8787)
server.listen(port, '127.0.0.1', () => {
  console.log(`Lodge server: http://127.0.0.1:${port}`)
  void (async () => {
    await live.start()
  })()
})
