import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { requestGuard } from './http-guard.js'
import {
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_BYTES,
  isNativeImage,
} from '../shared/attachments.js'
import { matchRoomAction } from './route-table.js'
import * as log from './crew/log.js'
import { pageAssignments } from './crew/assignment-history.js'
import { presentRoom } from './crew/presentation.js'

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
// HTML 不进浏览器缓存：每次构建后资源名会变，缓存住旧页面会一直跑旧界面。
const htmlHeaders = { 'content-type': MIME['.html'], 'content-security-policy': CSP, 'cache-control': 'no-store' }

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

// 响应已经开头（事件流、静态文件或下载）之后不能再写 JSON 头；
// 这时只断掉这一条连接。否则二次 writeHead 会把整个进程带走。
export const fail = (res, error) => {
  const message = String(error?.message ?? error)
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded) res.destroy?.()
    return
  }
  if (message === '附件太大') return json(res, 413, { error: '附件太大' })
  return json(res, 500, { error: message })
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

// 动作接口也要返回和房间事件同一份投影；否则前端用原始房间覆盖后会丢掉交付卡。
const withPresentedRoom = (store, result) => {
  const room = result?.body?.room
  if (result?.ok === false || room === null || typeof room !== 'object' || room.kind !== 'room' || typeof room.id !== 'string') {
    return result
  }
  const messages = store.readRecentMessages?.(room.id) ?? store.readMessages?.(room.id) ?? []
  const assignments = store.readAssignments?.(room.id, { limit: 500 }) ?? []
  return { ...result, body: { ...result.body, room: presentRoom(room, messages, assignments) } }
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

const readRaw = (req, limit) => new Promise((resolveBody, reject) => {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit) {
    req.resume()
    reject(new Error('附件太大'))
    return
  }
  const chunks = []
  let received = 0
  let settled = false
  req.on('data', chunk => {
    if (settled) return
    received += chunk.length
    if (received > limit) {
      settled = true
      reject(new Error('附件太大'))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (settled) return
    settled = true
    resolveBody(Buffer.concat(chunks))
  })
  req.on('error', error => {
    if (settled) return
    settled = true
    reject(error)
  })
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
    const blocked = requestGuard(req, path)
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

    if (path === '/api/profile' && req.method === 'POST') {
      return respond(res, service.saveProfile(await readJson(req)))
    }

    if (path === '/api/settings/email' && req.method === 'GET') {
      return respond(res, service.emailSettings())
    }

    if (path === '/api/settings/email' && req.method === 'POST') {
      log.info('[lodge] 收到邮箱设置请求')
      const body = await readJson(req)
      if (body?.action === 'test') return respond(res, await service.testEmail(body))
      if (body?.action === 'clear') {
        log.info('[lodge] 邮箱设置已断开')
        return respond(res, service.clearEmailSettings())
      }
      const saved = service.saveEmailSettings(body)
      // 只记结果，不记地址和密码；保存没到达或没通过时，日志是唯一的现场。
      if (saved?.ok === true) log.info('[lodge] 邮箱设置已保存')
      else log.warn(`[lodge] 邮箱设置没保存：${saved?.error ?? '未知原因'}`)
      return respond(res, saved)
    }

    if (path === '/api/rooms' && req.method === 'POST') {
      return respond(res, await service.createRoom(await readJson(req)))
    }

    if (path === '/api/rooms/sample' && req.method === 'POST') {
      const body = await readJson(req)
      return respond(res, await service.createSampleRoom(body?.kind === 'chat' ? 'chat' : 'studio'))
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

    if (path === '/api/attachments' && req.method === 'POST') {
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      const limit = isNativeImage(mime) ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_FILE_MAX_BYTES
      const bytes = await readRaw(req, limit)
      return respond(res, await service.uploadAttachment({
        bytes,
        mime,
        name: url.searchParams.get('name') ?? '',
      }))
    }

    const attachmentPath = path.match(/^\/api\/attachments\/([A-Za-z0-9._-]+)$/)
    if (attachmentPath !== null && req.method === 'GET') {
      const result = await service.attachmentBytes({ name: attachmentPath[1] })
      if (result.ok !== true) return json(res, STATUS[result.reason] ?? 500, { error: result.error })
      const { bytes, mime } = result.body
      res.writeHead(200, {
        'content-type': mime,
        'content-length': bytes.length,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      return res.end(bytes)
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

    const roundDetailPath = path.match(/^\/api\/rooms\/([\w-]+)\/rounds\/([\w-]+)$/)
    if (roundDetailPath !== null && req.method === 'GET') {
      const [, roomId, roundId] = roundDetailPath
      return respond(res, await service.roundDetail(roomId, roundId))
    }

    const roomAction = matchRoomAction(path)
    if (roomAction !== null) {
      const result = await service.roomRequest(roomAction.roomId, roomAction.action, {
        method: req.method,
        readBody: () => readJson(req),
      })
      return respond(res, withPresentedRoom(store, result))
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: '没有这个接口' })
    if (req.method !== 'GET') return json(res, 405, { error: '只接受 GET' })
    return serveStatic(root, req, res, path)
  } catch (error) {
    return fail(res, error)
  }
}
