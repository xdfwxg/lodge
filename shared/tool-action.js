import { isGateToolName } from './gate.js'

// 工具名到语义动作的唯一映射：权限、审批和界面都只认 read/exec/write/gate。
// 名字是外部事实，分类是业务策略；两边共用这一份，别在适配器或界面里各写一套。
export const actionForTool = tool => {
  const name = String(tool ?? '').toLowerCase()
  if (name === '') return null
  // 内置判定工具只提交结论，不是 shell，也不走外部动作审批。
  if (isGateToolName(name)) return 'gate'
  if (/(write|edit|multiedit|notebookedit)/.test(name)) return 'write'
  if (/(bash|shell|exec|command|terminal|kill)/.test(name)) return 'exec'
  // MCP 工具名可能带 list/search 等词，不能先按本地只读工具放行。
  if (/^mcp__/.test(name)) return 'exec'
  if (/(read|grep|glob|ls|list|notebookread)/.test(name)) return 'read'
  // 网络、浏览器和 MCP 工具不是本地读写；按 exec 权限处理，再走外部动作审批。
  if (/(webfetch|websearch|browser|fetch|http|mcp)/.test(name)) return 'exec'
  return null
}
