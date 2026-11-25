// 本地 API 只服务本机页面：拒绝外部 Host、跨站 Origin，以及浏览器表单能伪造的简单请求体。
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const loopbackHost = value => {
  if (typeof value !== 'string' || value.trim() === '') return false
  if (/[\s/\\]/.test(value)) return false
  try {
    const url = new URL(`http://${value}`)
    if (url.username !== '' || url.password !== '' || url.pathname !== '/') return false
    return LOOPBACK.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export const loopbackOrigin = value => {
  if (typeof value !== 'string' || value === '') return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return LOOPBACK.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

const hasBody = req => {
  const length = Number(req.headers['content-length'] ?? 0)
  return (Number.isFinite(length) && length > 0) || req.headers['transfer-encoding'] !== undefined
}

// 附件上传要发原始字节；只有这一条路径例外，其余写请求仍然只收 JSON。
const RAW_UPLOAD = '/api/attachments'

export const requestGuard = (req, path = '', { actionToken = null } = {}) => {
  if (!loopbackHost(req.headers.host)) return '只接受本机请求'
  if (!WRITE_METHODS.has(req.method)) return null
  // 桌面版给写操作加一道进程外令牌：执行官的 shell 也走本机回环，不能让它替人点“可以做”。
  // 上传是原始字节流，UI 直接用 fetch；其余 /api 写请求只能通过桌面 IPC 代理。
  if (actionToken !== null && actionToken !== '' && path.startsWith('/api/') && path !== RAW_UPLOAD) {
    if (req.headers['x-lodge-action'] !== actionToken) return '这个操作只能从 Lodge 窗口发起'
  }
  // 浏览器一定带 Origin；没有 Origin 的是本机 curl、脚本或测试。
  const origin = req.headers.origin
  if (origin !== undefined && !loopbackOrigin(origin)) return '不接受跨站请求'
  if (hasBody(req)) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    // 跨站表单只能用 text/plain 等简单类型；要求 JSON 让浏览器先发预检，而预检不会被放行。
    if (path === RAW_UPLOAD && req.method === 'POST') return null
    if (type !== 'application/json') return '请求体必须是 JSON'
  }
  return null
}
