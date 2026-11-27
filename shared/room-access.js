import { BROWSER_MCP_SERVER_NAME } from './browser-mcp.js'

export const isBrowserTool = tool => (
  typeof tool === 'string' && tool.startsWith(`mcp__${BROWSER_MCP_SERVER_NAME}__`)
)

// 只读研究是系统能力：网页、搜索和抓取；命令、写入和付款仍照旧确认。
const RESEARCH_TOOLS = new Set(['WebSearch', 'WebFetch', 'web_search', 'web_fetch'])

const browserToolName = tool => {
  const prefix = `mcp__${BROWSER_MCP_SERVER_NAME}__`
  return isBrowserTool(tool) ? tool.slice(prefix.length) : ''
}

// 浏览器既能读也能操作。只有这些名字是研究；点击、填表、上传、执行脚本一律走审批。
const READ_ONLY_BROWSER_TOOLS = new Set([
  'navigate_page',
  'select_page',
  'list_pages',
  'take_snapshot',
  'take_screenshot',
  'get_console_message',
  'list_console_messages',
  'get_network_request',
  'list_network_requests',
  'wait_for',
])

export const isReadOnlyBrowserTool = tool => {
  const name = browserToolName(tool)
  return name !== '' && READ_ONLY_BROWSER_TOOLS.has(name)
}

export const isReadOnlyResearchTool = tool => (
  isReadOnlyBrowserTool(tool) || (typeof tool === 'string' && RESEARCH_TOOLS.has(tool))
)

export const browserGrantsOf = member => [
  ...(Array.isArray(member?.mcp) ? member.mcp : []),
  ...(Array.isArray(member?.body?.spec?.mcp) ? member.body.spec.mcp : []),
]

export const hasBrowserGrant = member => browserGrantsOf(member)
  .some(grant => grant?.server === BROWSER_MCP_SERVER_NAME)

// 浏览器以外的外部工具仍然受角色契约约束；这个判断只放行只读公网浏览。
// 浏览器授权只是“只读研究”这项能力的载体：用服务器名和审批口径认它。
// 哪些浏览器工具算只读由工具名那张表说了算（READ_ONLY_BROWSER_TOOLS），
// 不靠一个没人执行的 scopes 字段假装是“只读授权”。
export const isBrowserGrant = grant => (
  grant?.server === BROWSER_MCP_SERVER_NAME && grant.approval === 'ask'
)
