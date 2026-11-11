import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDigest } from './crew/digest.js'
import { createLiveRooms } from './crew/live.js'
import { acquireDataLock } from './crew/lock.js'
import { presentRoom } from './crew/presentation.js'
import { createCrewService } from './crew/service.js'
import { collectWorkspaceGarbage } from './crew/workspace-gc.js'
import { seedIfEmpty } from './crew/seeds.js'
import { SEATS } from './crew/seats.js'
import { createStore } from './crew/store.js'
import { createEngine } from './engine.js'

// 组合根：只做装配与 HTTP 传输，业务全在 server/crew/。
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

const store = createStore({ dataDir, emit: broadcast })
seedIfEmpty(store)

// 房间事件和 /api/state 用同一份投影；UI 只消费 needsYou/独立性文案。
const emit = (event, payload, id) => {
  if (event === 'room' && payload !== null && typeof payload?.id === 'string') {
    payload = presentRoom(payload, store.readMessages(payload.id))
  }
  broadcast(event, payload, id)
}

const digest = createDigest({
  readRoom: store.readRoom,
  readRooms: store.readRooms,
  readMessages: store.readMessages,
})

const engine = createEngine()

const live = createLiveRooms({
  store,
  engine,
  emit,
  dispatchPayload: digest.dispatchPayload,
})

const service = createCrewService({
  store,
  engine,
  live,
  emit,
  dispatchPayload: digest.dispatchPayload,
  seats: SEATS,
})

const runWorkspaceGc = () => {
  try {
    const result = collectWorkspaceGarbage({ store })
    if (result.pruned > 0 || result.orphans > 0) {
      console.log(`workspace gc: pruned ${result.pruned} seats, removed ${result.orphans} orphan dirs`)
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
      return json(res, 200, service.state())
    }

    if (path === '/api/health' && req.method === 'GET') {
      return respond(res, await service.health())
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

    if (path === '/api/rooms' && req.method === 'POST') {
      return respond(res, await service.createRoom(await readJson(req)))
    }

    if (path === '/api/roster/recommend' && req.method === 'POST') {
      return respond(res, await service.recommendRoster(await readJson(req)))
    }

    const evidencePath = path.match(/^\/api\/rooms\/([\w-]+)\/evidence\/([\w-]+)$/)
    if (evidencePath !== null && req.method === 'GET') {
      const [, roomId, messageId] = evidencePath
      return respond(res, service.evidence(roomId, messageId))
    }

    const roomAction = path.match(/^\/api\/rooms\/([^/]+)\/(messages|accept|simulate|pause|resume|stop|acceptance|verify|budget)$/)
    if (roomAction !== null) {
      const [, roomId, action] = roomAction
      return respond(res, await service.roomRequest(roomId, action, {
        method: req.method,
        readBody: () => readJson(req),
      }))
    }

    const dispatchAction = path.match(/^\/api\/dispatch\/requests(?:\/([^/]+)\/(confirm|decline))?$/)
    if (dispatchAction !== null) {
      const [, requestId, action] = dispatchAction
      return respond(res, await service.dispatchRequest(requestId, action, {
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

const port = Number(process.env.CREW_PORT ?? 8787)
server.listen(port, '127.0.0.1', () => {
  console.log(`Lodge server: http://127.0.0.1:${port}`)
  void live.start()
})
