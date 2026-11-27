import { DESKTOP_MCP_PORTS, DESKTOP_MCP_SERVER_NAME } from '../shared/desktop-mcp.js'

// 电脑操作不是一个内建引擎：它是外部提供一个 MCP 服务器，以登录用户身份跑在沙箱外。
// Lodge 只登记它、把它挂给成员、把工具事件和截图收进房间。
const parts = url => {
  const match = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+):(\d+)/i.exec(url)
  if (match === null) return null
  const host = match[1].replace(/^\[|\]$/g, '').toLowerCase()
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null
  return { port: Number(match[2]) }
}

export const desktopMcpUrl = () => {
  const raw = typeof process.env.LODGE_DESKTOP_MCP_URL === 'string' ? process.env.LODGE_DESKTOP_MCP_URL.trim() : ''
  // 提供方必须在本机回环、且落在沙箱允许的端口区间：远程地址会被出口门挡掉，
  // 区间外的端口在 Windows 上会让每一回合都失败。
  const parsed = parts(raw)
  return parsed !== null && parsed.port >= DESKTOP_MCP_PORTS[0] && parsed.port <= DESKTOP_MCP_PORTS[1] ? raw : ''
}

export const desktopMcpAvailable = () => desktopMcpUrl() !== ''

export const desktopMcpConfig = () => ({
  name: DESKTOP_MCP_SERVER_NAME,
  url: desktopMcpUrl(),
  enabled: true,
})

export const desktopGrant = () => ({
  server: DESKTOP_MCP_SERVER_NAME,
  approval: 'auto',
})

// 每个 engine 只登记一次；同 URL 不重复建，停用了就恢复。
const ready = new WeakMap()

export const ensureDesktopMcp = async engine => {
  if (!desktopMcpAvailable()) return false
  const cacheable = engine !== null && typeof engine === 'object'
  if (cacheable && ready.has(engine)) return ready.get(engine)
  const task = (async () => {
    if (typeof engine?.mcp?.list !== 'function' || typeof engine.mcp.create !== 'function') return false
    const config = desktopMcpConfig()
    const listed = await engine.mcp.list()
    const servers = Array.isArray(listed) ? listed : listed?.servers ?? []
    const existing = servers.find(server => server?.name === DESKTOP_MCP_SERVER_NAME)
    if (existing !== undefined) {
      if (existing.url !== config.url && typeof engine.mcp.update === 'function') {
        const { name, ...body } = config
        await engine.mcp.update(DESKTOP_MCP_SERVER_NAME, { ...body, enabled: true })
      } else if (existing.enabled === false && typeof engine.mcp.patch === 'function') {
        await engine.mcp.patch(DESKTOP_MCP_SERVER_NAME, { enabled: true })
      }
      return true
    }
    await engine.mcp.create(config)
    return true
  })().catch(error => {
    if (cacheable) ready.delete(engine)
    console.warn(`[lodge] 电脑操作的提供方没有登记上：${error?.message ?? error}`)
    return false
  })
  if (cacheable) ready.set(engine, task)
  return task
}
