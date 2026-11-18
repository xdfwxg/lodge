import { fileURLToPath } from 'node:url'
import { GATE_SERVER_NAME } from '../../../shared/gate.js'

export { GATE_SERVER_NAME } from '../../../shared/gate.js'

const SERVER_FILE = fileURLToPath(new URL('./mcp-server.js', import.meta.url))
let ready = null

// 内置工具只注册一次；失败时下一次建房再试，房间仍可退回文本判定。
export const ensureGateServer = async engine => {
  if (ready !== null) return ready
  ready = (async () => {
    if (typeof engine?.mcp?.list !== 'function' || typeof engine.mcp.create !== 'function') return false
    const listed = await engine.mcp.list()
    const servers = Array.isArray(listed) ? listed : listed?.servers ?? []
    const existing = servers.find(server => server?.name === GATE_SERVER_NAME)
    if (existing !== undefined) {
      const commandChanged = typeof existing.command === 'string' &&
        (existing.command !== process.execPath ||
          (Array.isArray(existing.args) ? existing.args[0] : undefined) !== SERVER_FILE)
      try {
        if (commandChanged && typeof engine.mcp.update === 'function') {
          await engine.mcp.update(GATE_SERVER_NAME, {
            command: process.execPath,
            args: [SERVER_FILE],
            enabled: true,
          })
        } else if (existing.enabled === false && typeof engine.mcp.patch === 'function') {
          await engine.mcp.patch(GATE_SERVER_NAME, { enabled: true })
        }
      } catch (error) {
        console.warn(`[lodge] 判定工具没能更新：${error?.message ?? error}`)
      }
      return true
    }
    const created = await engine.mcp.create({
      name: GATE_SERVER_NAME,
      command: process.execPath,
      args: [SERVER_FILE],
      enabled: true,
    })
    const added = Array.isArray(created) ? created : created?.servers ?? []
    const server = added.find(item => item?.name === GATE_SERVER_NAME)
    // 基座新建的 MCP 服务默认停用；建完立刻打开，否则成员拿不到工具。
    if (server?.enabled === false && typeof engine.mcp.patch === 'function') {
      await engine.mcp.patch(GATE_SERVER_NAME, { enabled: true })
    }
    return true
  })().catch(error => {
    ready = null
    throw error
  })
  return ready
}

// 只有规划和验收需要提交判定；执行成员不加载这个工具。
export const roomToolsFor = member => (
  member?.role === 'lead' || member?.role === 'verifier' ? [GATE_SERVER_NAME] : []
)
