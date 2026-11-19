import { BROWSER_MCP_SERVER_NAME } from './browser-mcp.js'

export const isBrowserTool = tool => (
  typeof tool === 'string' && tool.startsWith(`mcp__${BROWSER_MCP_SERVER_NAME}__`)
)

// 只读研究是系统能力：网页、搜索和抓取；命令、写入和付款仍照旧确认。
const RESEARCH_TOOLS = new Set(['WebSearch', 'WebFetch', 'web_search', 'web_fetch'])

export const isReadOnlyResearchTool = tool => (
  isBrowserTool(tool) || (typeof tool === 'string' && RESEARCH_TOOLS.has(tool))
)

export const browserGrantsOf = member => [
  ...(Array.isArray(member?.mcp) ? member.mcp : []),
  ...(Array.isArray(member?.body?.spec?.mcp) ? member.body.spec.mcp : []),
]

export const hasBrowserGrant = member => browserGrantsOf(member)
  .some(grant => grant?.server === BROWSER_MCP_SERVER_NAME)

// 浏览器以外的外部工具仍然受角色契约约束；这个判断只放行只读公网浏览。
export const isBrowserGrant = grant => (
  grant?.server === BROWSER_MCP_SERVER_NAME &&
  Array.isArray(grant.scopes) &&
  grant.scopes.length === 1 &&
  grant.scopes[0] === 'read' &&
  grant.approval === 'ask'
)
