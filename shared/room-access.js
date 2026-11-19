import { BROWSER_MCP_SERVER_NAME } from './browser-mcp.js'

// 房间权限只有两档；能力在成员上，权限在房间上。
export const ROOM_ACCESS = Object.freeze({
  ASK: 'ask',
  PUBLIC_WEB: 'allow',
})

export const ROOM_ACCESS_OPTIONS = Object.freeze([
  { value: ROOM_ACCESS.ASK, label: '每次确认' },
  { value: ROOM_ACCESS.PUBLIC_WEB, label: '房间免确认' },
])

export const roomAccessOf = room => (
  room?.roomAccess === ROOM_ACCESS.PUBLIC_WEB ? ROOM_ACCESS.PUBLIC_WEB : ROOM_ACCESS.ASK
)

export const roomAccessFromBrowser = browser => (
  browser === true ? ROOM_ACCESS.PUBLIC_WEB : ROOM_ACCESS.ASK
)

export const parseRoomAccess = value => {
  if (value === ROOM_ACCESS.PUBLIC_WEB) return ROOM_ACCESS.PUBLIC_WEB
  if (value === ROOM_ACCESS.ASK) return ROOM_ACCESS.ASK
  return null
}

export const isBrowserTool = tool => (
  typeof tool === 'string' && tool.startsWith(`mcp__${BROWSER_MCP_SERVER_NAME}__`)
)

// 房间免确认只跳过只读研究：网页、搜索和抓取；命令、写入和付款仍照旧。
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

export const roomHasBrowserCapability = room => (Array.isArray(room?.members) ? room.members : [])
  .some(member => hasBrowserGrant(member))
