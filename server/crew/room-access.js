import { BROWSER_MCP_SERVER_NAME } from '../../shared/browser-mcp.js'
import {
  hasBrowserGrant,
  isBrowserTool,
  isReadOnlyResearchTool,
  roomAccessOf,
  ROOM_ACCESS,
} from '../../shared/room-access.js'

export { hasBrowserGrant }

export const needsBrowser = roster => (Array.isArray(roster) ? roster : [])
  .some(member => member?.role === 'worker' && hasBrowserGrant(member))

// 只给第一个执行官；已经有的不重复加。
export const grantBrowserToFirstWorker = roster => {
  let granted = false
  return (Array.isArray(roster) ? roster : []).map(member => {
    if (granted || member?.role !== 'worker') return member
    granted = true
    if (hasBrowserGrant(member)) return member
    return {
      ...member,
      mcp: [...(Array.isArray(member?.mcp) ? member.mcp : []), {
        server: BROWSER_MCP_SERVER_NAME,
        scopes: ['read'],
        approval: 'ask',
      }],
    }
  })
}

// 房间免确认只跳过只读研究工具；浏览器还要成员真的持有浏览器能力。
export const canSkipApproval = ({ room, member, tool }) => {
  if (roomAccessOf(room) !== ROOM_ACCESS.PUBLIC_WEB) return false
  if (!isReadOnlyResearchTool(tool)) return false
  return isBrowserTool(tool) ? hasBrowserGrant(member) : true
}
