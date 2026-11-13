// Planner 的聊天级工具协议：工具调用是结构化文本，Lodge 解析后执行；
// 这不是新的 roleKind，也不让 Planner 自己伪造执行结果。
export const PLANNER_TOOL_NAMES = ['create_subroom', 'reject_plan', 'check_gate']

const TOOL_PATTERN = /<lodge-tool>\s*([\s\S]*?)\s*<\/lodge-tool>/i

export const parsePlannerTool = text => {
  const match = String(text ?? '').match(TOOL_PATTERN)
  if (match === null) return null
  try {
    const parsed = JSON.parse(match[1])
    if (!PLANNER_TOOL_NAMES.includes(parsed?.name)) return null
    const args = parsed?.args !== null && typeof parsed?.args === 'object' ? parsed.args : {}
    return { name: parsed.name, args }
  } catch {
    return null
  }
}

export const plannerToolPrompt = () => [
  'Planner 工具协议（只在确实需要时使用）：',
  '<lodge-tool>{"name":"create_subroom","args":{"goal":"子任务目标"}}</lodge-tool>',
  '<lodge-tool>{"name":"reject_plan","args":{"reason":"不可行理由"}}</lodge-tool>',
  '<lodge-tool>{"name":"check_gate","args":{"goal":"待检查目标"}}</lodge-tool>',
  '工具结果由 Lodge 回写；不要伪造工具结果，也不要用工具替代当前阶段交付。',
]
