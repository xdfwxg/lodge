import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { requestGuard } from './http-guard.js'
import { matchRoomAction } from './route-table.js'
import { pageAssignments } from './crew/assignment-history.js'

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

export const STATUS = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  method: 405,
  conflict: 409,
  upstream: 502,
  unavailable: 503,
}

export const json = (res, status, body) => {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

export const respond = (res, result) => {
  if (result.ok === false) {
    return json(res, STATUS[result.reason] ?? 500, {
      error: result.error,
      ...(result.fields === null || typeof result.fields !== 'object' ? {} : result.fields),
    })
  }
  if ('bytes' in result) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': result.bytes.length })
    return res.end(result.bytes)
  }
  const status = result.created === true ? 201 : result.accepted === true ? 202 : 200
  return json(res, status, result.body)
}

export const readJson = (req, limit = 64 * 1024) => new Promise((resolveBody, reject) => {
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

const serveStatic = (root, req, res, pathname) => {
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

export const createHttpHandler = ({
  root,
  service,
  store,
  clients,
  send,
  chooseDirectory,
  openPath,
}) => async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname

  try {
    const blocked = requestGuard(req)
    if (blocked !== null) return json(res, 403, { error: blocked })

    if (path === '/api/state' && req.method === 'GET') {
      return json(res, 200, await service.state())
    }

    if (path === '/api/health' && req.method === 'GET') {
      return respond(res, await service.health())
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

    if (path === '/api/workspace/memory' && req.method === 'GET') {
      return respond(res, await service.workspaceMemory({
        sourceRepo: url.searchParams.get('path') ?? '',
        limit: Number(url.searchParams.get('limit') ?? 20),
      }))
    }

    if (path === '/api/workspace/memory/review' && req.method === 'POST') {
      const body = await readJson(req)
      return respond(res, await service.workspaceMemoryReview({
        sourceRepo: body.path,
        memoryId: body.memoryId,
        decision: body.decision,
      }))
    }

    const artifactPath = path.match(/^\/api\/rooms\/([\w-]+)\/artifact$/)
    if (artifactPath !== null && req.method === 'GET') {
      const [, roomId] = artifactPath
      return respond(res, await service.artifact({
        roomId,
        path: url.searchParams.get('path') ?? '',
      }))
    }

    const memoryPath = path.match(/^\/api\/rooms\/([\w-]+)\/memory$/)
    if (memoryPath !== null && req.method === 'GET') {
      const [, roomId] = memoryPath
      return respond(res, await service.memory({ roomId, limit: Number(url.searchParams.get('limit') ?? 20) }))
    }

    const memoryOptOutPath = path.match(/^\/api\/rooms\/([\w-]+)\/memory\/opt-out$/)
    if (memoryOptOutPath !== null && req.method === 'POST') {
      return respond(res, await service.forgetMemory({ roomId: memoryOptOutPath[1] }))
    }

    const memoryReviewPath = path.match(/^\/api\/rooms\/([\w-]+)\/memory\/([\w-]+)\/review$/)
    if (memoryReviewPath !== null && req.method === 'POST') {
      const [, roomId, memoryId] = memoryReviewPath
      const body = await readJson(req)
      return respond(res, await service.memoryReview({ roomId, memoryId, decision: body.decision }))
    }

    const evidencePath = path.match(/^\/api\/rooms\/([\w-]+)\/evidence\/([\w-]+)$/)
    if (evidencePath !== null && req.method === 'GET') {
      const [, roomId, messageId] = evidencePath
      return respond(res, await service.evidence(roomId, messageId))
    }

    const roomAction = matchRoomAction(path)
    if (roomAction !== null) {
      return respond(res, await service.roomRequest(roomAction.roomId, roomAction.action, {
        method: req.method,
        readBody: () => readJson(req),
      }))
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: '没有这个接口' })
    if (req.method !== 'GET') return json(res, 405, { error: '只接受 GET' })
    return serveStatic(root, req, res, path)
  } catch (error) {
    return json(res, 500, { error: String(error?.message ?? error) })
  }
}
