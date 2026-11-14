// MCP 调用审计：只解析 runtime 上报的工具名与计数，不新增调用真相。
// 兼容 mcp__server__tool 和 mcp:server:tool 两种命名。
export const mcpCalls = tools => {
  const calls = new Map()
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = typeof tool?.name === 'string' ? tool.name : ''
    let server = ''
    let method = ''
    if (name.startsWith('mcp__')) {
      const rest = name.slice(5)
      const split = rest.indexOf('__')
      if (split <= 0) continue
      server = rest.slice(0, split)
      method = rest.slice(split + 2)
    } else if (name.startsWith('mcp:')) {
      const parts = name.slice(4).split(':')
      if (parts.length < 2) continue
      server = parts[0]
      method = parts.slice(1).join(':')
    } else {
      continue
    }
    if (server === '' || method === '') continue
    const key = `${server}\u0000${method}`
    const current = calls.get(key) ?? { server, tool: method, count: 0, failed: 0 }
    current.count += typeof tool.count === 'number' ? tool.count : 0
    current.failed += typeof tool.failed === 'number' ? tool.failed : 0
    calls.set(key, current)
  }
  return [...calls.values()].sort((a, b) => b.count - a.count)
}
