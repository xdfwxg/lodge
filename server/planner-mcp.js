import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Planner 工具面：Lodge 自己跑一个无状态 MCP server，按房间注册到基座，
// 只挂给该房间的规划师。工具调用仍回到业务层执行，Planner 不能伪造结果。
export const PLANNER_TOOLS = [
  {
    name: 'create_subroom',
    description: '创建一个子工作室（只能是工作室，不能是聊天室），把独立的子目标交给它推进。最多嵌套 3 层；子工作室完成后只回传验收结论。',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '子工作室要达成的目标' },
        name: { type: 'string', description: '可选：子工作室名称' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'reject_plan',
    description: '在执行开始前拒绝当前目标，把房间标记为 rejected。执行开始后只能由验收员退回。',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '不可行的理由' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_gate',
    description: '对一个目标做 Gate 预检，返回是否准入、理由与建议。不会修改房间。',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '可选：待检查目标；默认当前房间目标' },
      },
      additionalProperties: false,
    },
  },
]

const TOOL_NAMES = new Set(PLANNER_TOOLS.map(tool => tool.name))
const ROOM_PATH = /^\/mcp\/planner\/(room-[A-Za-z0-9_-]{1,64})$/
const SERVER_PREFIX = 'lodge-planner-'
const PROTOCOL_VERSION = '2024-11-05'

const serverNameFor = roomId => `${SERVER_PREFIX}${roomId}`

const roomIdOfServer = name => name.startsWith(SERVER_PREFIX) ? name.slice(SERVER_PREFIX.length) : null

const secretFor = dataDir => {
  const file = join(dataDir, 'planner-mcp.secret')
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim()
    if (saved !== '') return saved
  }
  const secret = randomBytes(32).toString('hex')
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

const tokenFor = (dataDir, roomId) => createHmac('sha256', secretFor(dataDir)).update(roomId).digest('hex')

const sameToken = (given, expected) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const reply = (res, status, body) => {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  })
  res.end(data)
}

const readJson = (req, limit = 256 * 1024) => new Promise((resolve, reject) => {
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
      resolve(raw === '' ? null : JSON.parse(raw))
    } catch {
      reject(new Error('请求体不是 JSON'))
    }
  })
  req.on('error', reject)
})

const textResult = (text, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})

export const createPlannerMcp = ({
  client,
  dataDir,
  port,
  enabled = true,
  rooms = () => [],
  ttlMs = Number(process.env.PLANNER_MCP_STOP_TTL_MS ?? 10 * 60 * 1000),
  now = Date.now,
}) => {
  const origin = `http://127.0.0.1:${port}`
  const activeCalls = new Map()

  const callTool = async (roomId, params) => {
    const name = params?.name
    if (!TOOL_NAMES.has(name)) {
      return textResult(`未知 Planner 工具：${name ?? ''}`, true)
    }
    const args = params?.arguments !== null && typeof params?.arguments === 'object' ? params.arguments : {}
    const result = await client.invoke(roomId, { name, args })
    if (result?.ok === false) return textResult(String(result.error ?? '工具执行失败'), true)
    return textResult(JSON.stringify(result?.body ?? {}, null, 2))
  }

  const rpc = async (roomId, message) => {
    const method = message?.method
    const id = message?.id
    if (method === undefined) return null
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: typeof message.params?.protocolVersion === 'string'
            ? message.params.protocolVersion
            : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'lodge-planner', version: '1' },
        },
      }
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: PLANNER_TOOLS } }
    if (method === 'tools/call') {
      activeCalls.set(roomId, (activeCalls.get(roomId) ?? 0) + 1)
      try {
        const result = await callTool(roomId, message.params)
        return { jsonrpc: '2.0', id, result }
      } catch (error) {
        return { jsonrpc: '2.0', id, result: textResult(String(error?.message ?? error), true) }
      } finally {
        const remaining = (activeCalls.get(roomId) ?? 1) - 1
        if (remaining <= 0) activeCalls.delete(roomId)
        else activeCalls.set(roomId, remaining)
      }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `不支持的方法：${method}` } }
  }

  const handle = async (req, res, pathname) => {
    const match = ROOM_PATH.exec(pathname)
    if (match === null) return false
    if (req.method !== 'POST') {
      reply(res, 405, { error: '只接受 POST' })
      return true
    }
    const roomId = match[1]
    const given = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (given === '' || !sameToken(given, tokenFor(dataDir, roomId))) {
      reply(res, 401, { error: 'Planner 工具令牌无效' })
      return true
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      reply(res, 400, { error: String(error?.message ?? error) })
      return true
    }
    const messages = Array.isArray(body) ? body : [body]
    const answers = []
    for (const message of messages) {
      const answer = await rpc(roomId, message)
      if (answer !== null) answers.push(answer)
    }
    if (answers.length === 0) {
      reply(res, 202)
      return true
    }
    reply(res, 200, Array.isArray(body) ? answers : answers[0])
    return true
  }

  const ensure = async roomId => {
    if (!enabled) return null
    const name = serverNameFor(roomId)
    const entry = {
      type: 'http',
      url: `${origin}/mcp/planner/${roomId}`,
      headers: { Authorization: `Bearer ${tokenFor(dataDir, roomId)}` },
    }
    const listed = await client.mcp.list()
    const existing = (listed?.servers ?? []).find(server => server.name === name)
    if (existing === undefined) {
      try {
        await client.mcp.create({ name, ...entry })
      } catch (error) {
        const message = String(error?.message ?? error)
        if (message.includes('409')) {
          // 同名条目已经存在，继续启用即可。
        } else if (/at most 20/i.test(message)) {
          await sweep()
          await client.mcp.create({ name, ...entry })
        } else {
          throw error
        }
      }
    } else {
      await client.mcp.update(name, entry)
    }
    await client.mcp.patch(name, { enabled: true })
    return { server: name, transport: 'http' }
  }

  // 正在执行工具调用的房间不回收：等这一轮返回后再由下一次 sweep 处理。
  const release = async (roomId, { force = false } = {}) => {
    if (!force && (activeCalls.get(roomId) ?? 0) > 0) return false
    const name = serverNameFor(roomId)
    try {
      await client.mcp.remove(name)
      return true
    } catch {
      // 已经不存在就是清理完成。
      return false
    }
  }

  const listedServers = async () => {
    try {
      return (await client.mcp.list())?.servers ?? []
    } catch {
      return []
    }
  }

  // 只回收不该继续占名额的条目：房间不存在、非工作室、已结束，或 stopped 超过 TTL。
  const sweep = async (roomList = rooms()) => {
    if (!enabled) return { removed: 0, kept: 0 }
    const byId = new Map((Array.isArray(roomList) ? roomList : []).map(room => [room.id, room]))
    const listed = await listedServers()
    let removed = 0
    let kept = 0
    for (const server of listed) {
      const roomId = roomIdOfServer(server.name)
      if (roomId === null) continue
      const room = byId.get(roomId)
      const expired = room !== undefined &&
        room.roomType === 'studio' &&
        room.state === 'stopped' &&
        now() - Number(room.stoppedAt ?? 0) >= ttlMs
      const removable = room === undefined ||
        room.roomType !== 'studio' ||
        room.state === 'complete' ||
        room.state === 'rejected' ||
        expired
      if (!removable) { kept += 1; continue }
      const done = await release(roomId)
      if (done) removed += 1
      else kept += 1
    }
    return { removed, kept }
  }

  const stats = async () => ({
    enabled,
    registered: (await listedServers()).filter(server => roomIdOfServer(server.name) !== null).length,
    activeCalls: [...activeCalls.entries()].reduce((sum, [, count]) => sum + count, 0),
    ttlMs,
  })

  // 基座最多保存 20 个 MCP server：启动时先 sweep，再补齐带 Planner 工具标记的进行中房间。
  const reconcile = async roomList => {
    if (!enabled) return { added: 0, removed: 0 }
    const swept = await sweep(roomList)
    const active = (Array.isArray(roomList) ? roomList : []).filter(room => (
      room?.kind === 'room' &&
      room.roomType === 'studio' &&
      ['active', 'paused'].includes(room.state) &&
      typeof room.plannerTools?.server === 'string'
    ))
    const present = new Set((await listedServers()).map(server => server.name))
    let added = 0
    for (const room of active) {
      if (present.has(room.plannerTools.server)) continue
      try {
        await ensure(room.id)
        added += 1
      } catch {
        // 单个房间注册失败不阻塞启动；建房时会再次尝试并给出提示。
      }
    }
    return { added, removed: swept.removed }
  }

  return {
    handle,
    ensure,
    release,
    reconcile,
    sweep,
    stats,
    serverName: serverNameFor,
    tokenFor: roomId => tokenFor(dataDir, roomId),
    enabled,
  }
}
