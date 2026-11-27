import { BROWSER_MCP_SERVER_NAME } from '../../shared/browser-mcp.js'
import {
  hasBrowserGrant,
  isBrowserGrant,
  isBrowserTool,
  isReadOnlyResearchTool,
} from '../../shared/room-access.js'

export { hasBrowserGrant }

export const needsBrowser = roster => (Array.isArray(roster) ? roster : [])
  .some(member => hasBrowserGrant(member))

// 每个成员都带同一份只读公网能力；不按房间、不按成员单独开关。
export const grantBrowserToAll = roster => (Array.isArray(roster) ? roster : []).map(member => {
  if (hasBrowserGrant(member)) return member
  return {
    ...member,
    mcp: [...(Array.isArray(member?.mcp) ? member.mcp : []), {
      server: BROWSER_MCP_SERVER_NAME,
      approval: 'ask',
    }],
  }
})

// 浏览器没准备好时先拿掉这项能力，房间照常建；不拿一个用不了的按钮挡住建房。
export const stripBrowser = roster => (Array.isArray(roster) ? roster : []).map(member => ({
  ...member,
  mcp: (Array.isArray(member?.mcp) ? member.mcp : []).filter(grant => !isBrowserGrant(grant)),
}))

// 系统只跳过只读研究；命令、写入、付款等外部动作仍逐次确认。
export const canSkipApproval = ({ member, tool }) => {
  if (!isReadOnlyResearchTool(tool)) return false
  return isBrowserTool(tool) ? hasBrowserGrant(member) : true
}
